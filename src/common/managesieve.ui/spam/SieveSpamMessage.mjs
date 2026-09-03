/*
 * Helpers for listing and permanently cleaning messages from Thunderbird's
 * junk folder. These functions do not depend on Thunderbird APIs so that the
 * byte-preserving message rewrite can be covered by the regular test suite.
 */

const HEADER_SEPARATOR_CRLF = "\r\n\r\n";
const HEADER_SEPARATOR_LF = "\n\n";

/**
 * Converts a binary string into bytes without interpreting its encoding.
 *
 * @param {string} value
 *   a binary string returned by older Thunderbird versions.
 * @returns {Uint8Array}
 *   the original bytes.
 */
function binaryStringToBytes(value) {
  const bytes = new Uint8Array(value.length);

  for (let i = 0; i < value.length; i++)
    bytes[i] = value.charCodeAt(i) & 0xff;

  return bytes;
}

/**
 * Converts bytes to a one-code-unit-per-byte string.
 *
 * @param {Uint8Array} value
 *   source bytes.
 * @returns {string}
 *   a binary string.
 */
function bytesToBinaryString(value) {
  const chunks = [];
  const chunkSize = 0x8000;

  for (let offset = 0; offset < value.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(
      ...value.subarray(offset, Math.min(offset + chunkSize, value.length))));
  }

  return chunks.join("");
}

/**
 * Extracts the raw RFC 822 header block for copy and paste display.
 *
 * @param {Uint8Array} source
 *   complete RFC 822 message bytes.
 * @returns {string}
 *   header block without the empty separator line.
 */
function extractRawMessageHeaders(source) {
  const raw = bytesToBinaryString(source);
  let boundary = raw.indexOf(HEADER_SEPARATOR_CRLF);

  if (boundary < 0)
    boundary = raw.indexOf(HEADER_SEPARATOR_LF);
  if (boundary < 0)
    throw new Error("The selected message has no complete RFC 822 header block");

  const bytes = binaryStringToBytes(raw.slice(0, boundary));
  return (new TextDecoder()).decode(bytes);
}

/**
 * Extracts one normalized email address from a display address.
 *
 * @param {*} value
 *   for example `Person <person@example.test>`.
 * @returns {string}
 *   lowercase address or an empty string.
 */
function extractEmailAddress(value) {
  const matches = `${value || ""}`.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+/giu);
  return matches?.length ? matches[matches.length - 1].toLocaleLowerCase() : "";
}

/**
 * Removes Rspamd/SpamAssassin verdict headers and the configured subject
 * prefix while leaving every other source byte untouched.
 *
 * @param {Uint8Array} source
 *   complete RFC 822 message bytes.
 * @returns {{data: Uint8Array, subjectChanged: boolean, headersRemoved: number}}
 *   the rewritten message and a change summary.
 */
function cleanSpamMessage(source) {
  const raw = bytesToBinaryString(source);
  let separator = HEADER_SEPARATOR_CRLF;
  let boundary = raw.indexOf(separator);

  if (boundary < 0) {
    separator = HEADER_SEPARATOR_LF;
    boundary = raw.indexOf(separator);
  }

  if (boundary < 0)
    throw new Error("The selected message has no complete RFC 822 header block");

  let headers = raw.substring(0, boundary + separator.length / 2);
  const body = raw.substring(boundary + separator.length);
  const originalHeaders = headers;

  const subjectPrefix = /^(Subject:[ \t]*)(?:(?:\*+[ \t]*)?\[SPAM\](?:\([^\r\n)]*\))?(?:[ \t]*\*+)?|\*+[ \t]*SPAM[ \t]*\*+)[ \t]*/im;
  headers = headers.replace(subjectPrefix, "$1");
  const subjectChanged = headers !== originalHeaders;

  let headersRemoved = 0;
  headers = headers.replace(
    /^(?:X-Spam(?:-[A-Za-z0-9-]+)?|X-Rspamd(?:-[A-Za-z0-9-]+)?):[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*\r?\n/gim,
    () => {
      headersRemoved++;
      return "";
    });

  return {
    data: binaryStringToBytes(`${headers}${separator.substring(0, separator.length / 2)}${body}`),
    subjectChanged,
    headersRemoved
  };
}

/**
 * Finds an account folder by its Thunderbird special-use marker.
 * Supports both the legacy MV2 `type` property and current `specialUse` array.
 *
 * @param {object} account
 *   Thunderbird mail account.
 * @param {string} specialUse
 *   for example `junk` or `inbox`.
 * @returns {object|null}
 *   the matching folder or null.
 */
function findSpecialFolder(account, specialUse) {
  const pending = [];

  if (account.rootFolder)
    pending.push(account.rootFolder);
  if (Array.isArray(account.folders))
    pending.push(...account.folders);

  const visited = new Set();
  while (pending.length) {
    const folder = pending.shift();
    if (!folder || visited.has(folder))
      continue;

    visited.add(folder);
    if (folder.type === specialUse
        || (Array.isArray(folder.specialUse) && folder.specialUse.includes(specialUse))) {
      return folder;
    }

    if (Array.isArray(folder.subFolders))
      pending.push(...folder.subFolders);
  }

  return null;
}

/**
 * Tests the searchable message fields with one case-insensitive query.
 *
 * @param {object} message
 *   serialized message header.
 * @param {string} query
 *   user search text.
 * @returns {boolean}
 *   true when the row should be visible.
 */
function matchesSpamSearch(message, query) {
  query = `${query || ""}`.trim().toLocaleLowerCase();
  if (!query)
    return true;

  return [
    message.subject,
    message.author,
    ...(message.recipients || [])
  ].some((value) => {return `${value || ""}`.toLocaleLowerCase().includes(query);});
}

/**
 * Replaces existing copies transactionally using caller-provided storage
 * operations. If importing the replacement fails, the previous copy is
 * restored before the original error is rethrown.
 *
 * @param {object} operations
 *   duplicate replacement callbacks.
 * @param {boolean} operations.hasDuplicates
 *   whether the destination contains an existing copy.
 * @param {Function} operations.createBackup
 *   captures the existing destination copy.
 * @param {Function} operations.removeDuplicates
 *   removes all resolved destination duplicates.
 * @param {Function} operations.importReplacement
 *   imports the requested replacement.
 * @param {Function} operations.restoreBackup
 *   restores the captured destination copy after failure.
 * @returns {Promise<*>}
 *   the imported replacement.
 */
async function replaceDuplicateMessages(operations) {
  if (!operations.hasDuplicates)
    return await operations.importReplacement();

  const backup = await operations.createBackup();
  await operations.removeDuplicates();

  try {
    return await operations.importReplacement();
  } catch (importError) {
    try {
      await operations.restoreBackup(backup);
    } catch (restoreError) {
      throw new Error(
        `${importError.message || importError}; restoring the previous Inbox copy failed: `
        + `${restoreError.message || restoreError}`);
    }
    throw importError;
  }
}

export {
  binaryStringToBytes,
  cleanSpamMessage,
  extractEmailAddress,
  extractRawMessageHeaders,
  findSpecialFolder,
  matchesSpamSearch,
  replaceDuplicateMessages
};
