/*
 * Applies a stored Sieve script manually through Dovecot's experimental
 * IMAP FILTER=SIEVE extension.
 */

const FILTER_CAPABILITY = "FILTER=SIEVE";
const FILTER_COMMAND_LIMIT = 8000;

/**
 * Resolves the Inbox mailbox from an IMAP LIST response.
 *
 * @param {object[]} mailboxes
 *   ImapFlow LIST response.
 * @returns {string}
 *   Inbox mailbox path.
 */
function resolveInboxFolder(mailboxes) {
  const inbox = mailboxes.find((mailbox) => {
    return `${mailbox.specialUse || ""}`.toLocaleLowerCase() === "\\inbox";
  }) || mailboxes.find((mailbox) => {
    return `${mailbox.path || mailbox.name || ""}`.toLocaleLowerCase() === "inbox";
  });

  if (!inbox)
    throw new Error("The IMAP server did not report an Inbox folder");

  return inbox.path;
}

/**
 * Parses an opaque Inbox identifier produced by the direct IMAP list.
 *
 * @param {string} id
 *   UIDVALIDITY:UID identifier.
 * @returns {{uidValidity: string, uid: number}}
 *   validated message selection.
 */
function parseInboxMessageId(id) {
  const match = /^([1-9]\d*):([1-9]\d*)$/u.exec(`${id || ""}`);
  const uid = match ? Number.parseInt(match[2], 10) : Number.NaN;
  if (!match || !Number.isSafeInteger(uid))
    throw new Error("The selected Inbox message identifier is invalid");

  return { uidValidity: match[1], uid };
}

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
   * Confirms that one previously listed Inbox message still exists.
   *
   * @param {string} id
   *   opaque UIDVALIDITY:UID message identifier.
   * @returns {Promise<object>}
   *   exact one-message snapshot.
   */
  async prepareInbox(id) {
    const selection = parseInboxMessageId(id);

    return await this.withClient(async (client) => {
      const folder = resolveInboxFolder(await client.list());
      const lock = await client.getMailboxLock(folder, { readOnly: true });

      try {
        if (`${client.mailbox.uidValidity}` !== selection.uidValidity) {
          throw new Error(
            "The Inbox was recreated after it was loaded; no rule was applied");
        }

        const uids = await client.search({
          uid: `${selection.uid}`,
          deleted: false
        }, { uid: true }) || [];
        if (!uids.some((uid) => { return Number(uid) === selection.uid; }))
          throw new Error("The selected Inbox message is no longer available");

        return {
          folder,
          uidValidity: selection.uidValidity,
          uids: [selection.uid]
        };
      } finally {
        lock.release();
      }
    });
  }

  /**
   * Creates literal fileinto destinations which do not exist yet.
   *
   * @param {string[]} mailboxes
   *   literal mailbox names from the active script.
   * @returns {Promise<string[]>}
   *   mailbox names created by this call.
   */
  async ensureMailboxes(mailboxes) {
    const targets = [...new Set((mailboxes || [])
      .map((mailbox) => { return `${mailbox || ""}`.trim(); })
      .filter((mailbox) => { return mailbox && mailbox.toUpperCase() !== "INBOX"; }))];
    if (!targets.length)
      return [];

    return await this.withClient(async (client) => {
      const created = [];
      for (const mailbox of targets) {
        const result = await client.mailboxCreate(mailbox);
        if (result?.created !== false)
          created.push(result?.path || mailbox);
      }
      return created;
    });
  }

  /**
   * Applies a personal Sieve script to an earlier UID snapshot.
   *
   * @param {string} script
   *   stored personal script name.
   * @param {object} snapshot
   *   result of prepare().
   * @param {object} [options]
   *   optional Inbox-only post-processing.
   * @param {boolean} [options.expunge]
   *   permanently remove only filtered UIDs which FILTER marked as deleted.
   * @returns {Promise<object>}
   *   operation summary.
   */
  async apply(script, snapshot, options = {}) {
    const result = {
      selected: snapshot.uids.length,
      filtered: 0,
      warnings: 0,
      errors: 0,
      expunged: false,
      reports: []
    };
    if (!snapshot.uids.length)
      return result;

    return await this.withClient(async (client) => {
      if (options.expunge && !client.capabilities.has("UIDPLUS")) {
        throw new Error(
          "The IMAP server does not offer UIDPLUS for targeted EXPUNGE");
      }

      const lock = await client.getMailboxLock(snapshot.folder);

      try {
        if (`${client.mailbox.uidValidity}` !== snapshot.uidValidity) {
          throw new Error(
            "The selected folder was recreated after confirmation; no rule was applied");
        }

        const onFiltered = async (untagged) => {
          const report = flattenResponseValues(untagged?.attributes);
          const values = report.map((value) => { return value.toUpperCase(); });
          result.filtered++;
          result.reports.push(report.join(" "));
          if (values.includes("WARNINGS"))
            result.warnings++;
          if (values.includes("ERRORS"))
            result.errors++;
          untagged.next();
        };
        const onFilterProblem = async (untagged) => {
          const report = flattenResponseValues(untagged?.attributes);
          const values = report.map((value) => { return value.toUpperCase(); });
          result.reports.push(report.join(" "));
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

        if (options.expunge && !result.errors) {
          const response = await client.exec("UID EXPUNGE", [{
            type: "SEQUENCE",
            value: compactUidSet(snapshot.uids)
          }]);
          response.next();
          result.expunged = true;
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
  parseInboxMessageId,
  resolveInboxFolder,
  resolveSentFolder,
  SieveImapFilterClient
};
