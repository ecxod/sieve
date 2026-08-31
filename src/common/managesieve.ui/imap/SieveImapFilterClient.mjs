/*
 * Applies a stored Sieve script manually through Dovecot's experimental
 * IMAP FILTER=SIEVE extension.
 */

const FILTER_CAPABILITY = "FILTER=SIEVE";
const FILTER_COMMAND_LIMIT = 8000;

/**
 * Resolves the Sent mailbox from an IMAP LIST response.
 *
 * @param {object[]} mailboxes
 *   ImapFlow LIST response.
 * @returns {string}
 *   Sent mailbox path.
 */
function resolveSentFolder(mailboxes) {
  const sent = mailboxes.find((mailbox) => {
    return `${mailbox.specialUse || ""}`.toLocaleLowerCase() === "\\sent";
  }) || mailboxes.find((mailbox) => {
    return ["sent", "sent mail", "sent items", "gesendet"]
      .includes(`${mailbox.name || mailbox.path || ""}`.toLocaleLowerCase());
  });

  if (!sent)
    throw new Error("The IMAP server did not report a Sent folder");

  return sent.path;
}

/**
 * Compacts sorted UIDs into an IMAP sequence set.
 *
 * @param {number[]} values
 *   message UIDs.
 * @returns {string}
 *   compact IMAP sequence set.
 */
function compactUidSet(values) {
  const uids = [...new Set(values)]
    .filter((uid) => { return Number.isSafeInteger(uid) && uid > 0; })
    .sort((a, b) => { return a - b; });
  const ranges = [];

  for (let index = 0; index < uids.length;) {
    const start = uids[index];
    let end = start;

    while (index + 1 < uids.length && uids[index + 1] === end + 1) {
      index++;
      end = uids[index];
    }

    ranges.push(start === end ? `${start}` : `${start}:${end}`);
    index++;
  }

  return ranges.join(",");
}

/**
 * Splits a UID sequence set at comma boundaries so no FILTER command becomes
 * excessively large.
 *
 * @param {number[]} uids
 *   message UIDs.
 * @param {number} [limit]
 *   maximum sequence-set length.
 * @returns {string[]}
 *   compact sequence-set chunks.
 */
function chunkUidSet(uids, limit = FILTER_COMMAND_LIMIT) {
  const parts = compactUidSet(uids).split(",").filter(Boolean);
  const chunks = [];
  let current = "";

  for (const part of parts) {
    if (current && current.length + part.length + 1 > limit) {
      chunks.push(current);
      current = "";
    }

    current += current ? `,${part}` : part;
  }

  if (current)
    chunks.push(current);

  return chunks;
}

/**
 * Returns all scalar values from an ImapFlow parser node.
 *
 * @param {*} value
 *   parser value.
 * @returns {string[]}
 *   flattened scalar values.
 */
function flattenResponseValues(value) {
  if (Array.isArray(value))
    return value.flatMap(flattenResponseValues);
  if (value && typeof value === "object") {
    return [value.value, value.section, value.attributes]
      .flatMap(flattenResponseValues);
  }
  if (typeof value === "string" || typeof value === "number")
    return [`${value}`];
  return [];
}

/**
 * Direct IMAP adapter used by the Electron application.
 */
class SieveImapFilterClient {

  /**
   * @param {Function} createClient
   *   returns an ImapFlow-compatible client.
   */
  constructor(createClient) {
    this.createClient = createClient;
  }

  /**
   * Runs an operation with one authenticated IMAP connection.
   *
   * @param {Function} callback
   *   connected operation.
   * @returns {Promise<*>}
   *   callback result.
   */
  async withClient(callback) {
    const client = this.createClient();

    try {
      await client.connect();
      if (!client.capabilities.has(FILTER_CAPABILITY))
        throw new Error("The IMAP server does not offer FILTER=SIEVE");
      return await callback(client);
    } finally {
      if (client.usable !== false) {
        try {
          await client.logout();
        } catch {
          client.close();
        }
      }
    }
  }

  /**
   * Takes an immutable snapshot of current, non-deleted Sent messages.
   *
   * @returns {Promise<object>}
   *   folder, UIDVALIDITY and exact UID selection.
   */
  async prepare() {
    return await this.withClient(async (client) => {
      const folder = resolveSentFolder(await client.list());
      const lock = await client.getMailboxLock(folder, { readOnly: true });

      try {
        return {
          folder,
          uidValidity: `${client.mailbox.uidValidity}`,
          uids: await client.search({ deleted: false }, { uid: true }) || []
        };
      } finally {
        lock.release();
      }
    });
  }

  /**
   * Applies a personal Sieve script to an earlier UID snapshot.
   *
   * @param {string} script
   *   stored personal script name.
   * @param {object} snapshot
   *   result of prepare().
   * @returns {Promise<object>}
   *   operation summary.
   */
  async apply(script, snapshot) {
    if (!snapshot.uids.length) {
      return {
        selected: 0,
        filtered: 0,
        warnings: 0,
        errors: 0
      };
    }

    return await this.withClient(async (client) => {
      const lock = await client.getMailboxLock(snapshot.folder);
      const result = {
        selected: snapshot.uids.length,
        filtered: 0,
        warnings: 0,
        errors: 0
      };

      try {
        if (`${client.mailbox.uidValidity}` !== snapshot.uidValidity) {
          throw new Error(
            "The Sent folder was recreated after confirmation; no rule was applied");
        }

        const onFiltered = async (untagged) => {
          const values = flattenResponseValues(untagged?.attributes)
            .map((value) => { return value.toUpperCase(); });
          result.filtered++;
          if (values.includes("WARNINGS"))
            result.warnings++;
          if (values.includes("ERRORS"))
            result.errors++;
          untagged.next();
        };
        const onFilterProblem = async (untagged) => {
          const values = flattenResponseValues(untagged?.attributes)
            .map((value) => { return value.toUpperCase(); });
          if (values.includes("WARNINGS"))
            result.warnings++;
          if (values.includes("ERRORS"))
            result.errors++;
          untagged.next();
        };

        for (const uids of chunkUidSet(snapshot.uids)) {
          const response = await client.exec("UID FILTER", [
            { type: "ATOM", value: "SIEVE" },
            { type: "ATOM", value: "PERSONAL" },
            { type: "STRING", value: script },
            { type: "ATOM", value: "UID" },
            { type: "SEQUENCE", value: uids }
          ], {
            untagged: {
              FILTERED: onFiltered,
              FILTER: onFilterProblem
            }
          });
          response.next();
        }

        return result;
      } finally {
        lock.release();
      }
    });
  }
}

export {
  chunkUidSet,
  compactUidSet,
  resolveSentFolder,
  SieveImapFilterClient
};
