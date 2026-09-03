/*
 * Direct IMAP implementation for the desktop spam-folder view.
 */

import { cleanSpamMessage } from "./SieveSpamMessage.mjs";

const FLAG_DELETED = "\\Deleted";
const FLAG_RECENT = "\\Recent";
const FLAG_JUNK = "\\Junk";
const FLAG_NOT_JUNK = "$NotJunk";
const KEYWORD_JUNK = "$Junk";
const KEYWORD_HAM = "rspamdham";
const KEYWORD_ALLOW = "rspamdallow";

/**
 * Formats one IMAP envelope address for display and searching.
 *
 * @param {object} address
 *   ImapFlow address object.
 * @returns {string}
 *   formatted address.
 */
function formatAddress(address) {
  const email = `${address?.address || ""}`.trim();
  const name = `${address?.name || ""}`.trim();

  if (!name)
    return email;
  if (!email)
    return name;

  return `${name} <${email}>`;
}

/**
 * Finds the Junk and Inbox mailboxes returned by IMAP LIST.
 *
 * @param {object[]} mailboxes
 *   ImapFlow LIST response.
 * @returns {{junk: string, inbox: string}}
 *   resolved mailbox paths.
 */
function resolveSpamFolders(mailboxes) {
  const bySpecialUse = (specialUse) => {
    return mailboxes.find((mailbox) => {
      return `${mailbox.specialUse || ""}`.toLocaleLowerCase() === specialUse;
    });
  };
  const byName = (names) => {
    return mailboxes.find((mailbox) => {
      return names.includes(
        `${mailbox.name || mailbox.path || ""}`.toLocaleLowerCase());
    });
  };

  const junk = bySpecialUse("\\junk")
    || byName(["junk", "spam", "junk-e-mail", "bulk mail"]);
  const inbox = bySpecialUse("\\inbox")
    || mailboxes.find((mailbox) => {
      return `${mailbox.path}`.toLocaleLowerCase() === "inbox";
    });

  if (!junk)
    throw new Error("The IMAP server did not report a Junk or Spam folder");
  if (!inbox)
    throw new Error("The IMAP server did not report an Inbox folder");

  return { junk: junk.path, inbox: inbox.path };
}

/**
 * Resolves the account Inbox without requiring a Junk mailbox to exist.
 *
 * @param {object[]} mailboxes
 *   ImapFlow LIST response.
 * @returns {string}
 *   Inbox path.
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
 * Returns selectable server mailbox paths from an IMAP LIST response.
 *
 * @param {object[]} mailboxes
 *   ImapFlow LIST response.
 * @returns {string[]}
 *   mailbox paths in server order.
 */
function getSelectableMailboxPaths(mailboxes) {
  return mailboxes.filter((mailbox) => {
    const flags = mailbox.flags instanceof Set
      ? [...mailbox.flags] : (mailbox.flags || []);
    return !flags.some((flag) => {
      return `${flag}`.toLocaleLowerCase() === "\\noselect";
    });
  }).map((mailbox) => {
    return `${mailbox.path || mailbox.name || ""}`;
  }).filter(Boolean);
}

/**
 * Creates a selection identifier that becomes invalid if the mailbox is
 * recreated and receives a new UIDVALIDITY value.
 *
 * @param {bigint|number|string} uidValidity
 *   mailbox UID validity value.
 * @param {number} uid
 *   message UID.
 * @returns {string}
 *   opaque UI identifier.
 */
function createMessageId(uidValidity, uid) {
  return `${uidValidity}:${uid}`;
}

/**
 * Parses an opaque message selection identifier.
 *
 * @param {string} id
 *   opaque UI identifier.
 * @returns {{uidValidity: string, uid: number}}
 *   parsed values.
 */
function parseMessageId(id) {
  const match = /^(\d+):(\d+)$/.exec(`${id}`);
  if (!match)
    throw new Error("Invalid IMAP message identifier");

  return { uidValidity: match[1], uid: Number.parseInt(match[2], 10) };
}

/**
 * Prepares flags for the clean Inbox copy.
 *
 * @param {Set<string>} sourceFlags
 *   flags on the Junk-folder source.
 * @param {boolean} permanentAllow
 *   whether to request permanent sender allowlisting.
 * @returns {string[]}
 *   flags and Dovecot training keywords for APPEND.
 */
function getCleanFlags(sourceFlags, permanentAllow) {
  const blocked = new Set([
    FLAG_DELETED.toLocaleLowerCase(),
    FLAG_RECENT.toLocaleLowerCase(),
    FLAG_JUNK.toLocaleLowerCase(),
    KEYWORD_JUNK.toLocaleLowerCase()
  ]);
  const flags = [...(sourceFlags || [])]
    .filter((flag) => {
      return !blocked.has(`${flag}`.toLocaleLowerCase());
    });

  flags.push(FLAG_NOT_JUNK, KEYWORD_HAM);
  if (permanentAllow)
    flags.push(KEYWORD_ALLOW);

  return [...new Set(flags)];
}

/**
 * Direct IMAP adapter used by the Electron application.
 */
class SieveImapSpamClient {

  /**
   * Creates a direct-IMAP spam adapter.
   *
   * @param {Function} createClient
   *   returns a connected ImapFlow-compatible client after connect() is called.
   */
  constructor(createClient) {
    this.createClient = createClient;
  }

  /**
   * Runs one operation with an authenticated IMAP connection.
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
   * Lists all message envelopes in the account's Junk folder.
   *
   * @returns {Promise<object>}
   *   serialized spam-folder view.
   */
  async list() {
    return await this.withClient(async (client) => {
      const folders = resolveSpamFolders(await client.list());
      const lock = await client.getMailboxLock(folders.junk, { readOnly: true });

      try {
        const uidValidity = `${client.mailbox.uidValidity}`;
        const messages = client.mailbox.exists
          ? await client.fetchAll("1:*", {
            uid: true,
            envelope: true,
            internalDate: true
          }) : [];

        return {
          folderName: folders.junk,
          canCleanSource: true,
          messages: messages.map((message) => {
            return {
              id: createMessageId(uidValidity, message.uid),
              date: message.internalDate || message.envelope?.date || null,
              author: (message.envelope?.from || []).map(formatAddress).join(", "),
              recipients: (message.envelope?.to || []).map(formatAddress),
              subject: message.envelope?.subject || ""
            };
          }).reverse()
        };
      } finally {
        lock.release();
      }
    });
  }

  /**
   * Lists Inbox envelopes and selectable mailboxes for the rule helper.
   *
   * @returns {Promise<object>}
   *   serialized Inbox view.
   */
  async listInbox() {
    return await this.withClient(async (client) => {
      const mailboxes = await client.list();
      const inbox = resolveInboxFolder(mailboxes);
      const lock = await client.getMailboxLock(inbox, { readOnly: true });

      try {
        const uidValidity = `${client.mailbox.uidValidity}`;
        const messages = client.mailbox.exists
          ? await client.fetchAll("1:*", {
            uid: true,
            envelope: true,
            internalDate: true
          }) : [];

        return {
          folderName: inbox,
          mailboxes: getSelectableMailboxPaths(mailboxes),
          messages: messages.map((message) => {
            return {
              id: createMessageId(uidValidity, message.uid),
              date: message.internalDate || message.envelope?.date || null,
              author: (message.envelope?.from || []).map(formatAddress).join(", "),
              recipients: (message.envelope?.to || []).map(formatAddress),
              subject: message.envelope?.subject || ""
            };
          }).reverse()
        };
      } finally {
        lock.release();
      }
    });
  }

  /**
   * Loads raw headers and decoded rule parameters for one Junk message.
   *
   * @param {string} id
   *   opaque message selection identifier.
   * @returns {Promise<object>}
   *   headers and normalized message parameters.
   */
  async getDetails(id) {
    return await this.withClient(async (client) => {
      const folders = resolveSpamFolders(await client.list());
      const selection = parseMessageId(id);
      const lock = await client.getMailboxLock(folders.junk, { readOnly: true });

      try {
        if (`${client.mailbox.uidValidity}` !== selection.uidValidity)
          throw new Error("The Spam folder changed; refresh the message list and try again");

        const message = await client.fetchOne(selection.uid, {
          uid: true,
          headers: true,
          envelope: true
        }, { uid: true });
        if (!message || !message.headers)
          throw new Error("The selected spam message no longer exists");

        const envelope = message.envelope || {};
        const senders = envelope.from || envelope.sender || [];
        const recipients = [
          ...(envelope.to || []),
          ...(envelope.cc || [])
        ];
        const senderAddress = `${senders[0]?.address || ""}`.trim();
        const senderDomain = senderAddress.includes("@")
          ? senderAddress.slice(senderAddress.lastIndexOf("@") + 1).toLocaleLowerCase()
          : "";

        return {
          id,
          headers: message.headers.toString("utf8").replace(/\r?\n$/, ""),
          sender: senders.map(formatAddress).join(", "),
          senderAddress,
          senderDomain,
          recipients: recipients.map(formatAddress),
          recipientAddresses: [...new Set(recipients
            .map((address) => { return `${address.address || ""}`.trim(); })
            .filter(Boolean))],
          subject: envelope.subject || "",
          messageId: envelope.messageId || ""
        };
      } finally {
        lock.release();
      }
    });
  }

  /**
   * Loads raw headers and rule parameters for one Inbox message.
   *
   * @param {string} id
   *   opaque message selection identifier.
   * @returns {Promise<object>}
   *   headers and normalized message parameters.
   */
  async getInboxDetails(id) {
    return await this.withClient(async (client) => {
      const inbox = resolveInboxFolder(await client.list());
      const selection = parseMessageId(id);
      const lock = await client.getMailboxLock(inbox, { readOnly: true });

      try {
        if (`${client.mailbox.uidValidity}` !== selection.uidValidity)
          throw new Error("The Inbox changed; refresh the message list and try again");

        const message = await client.fetchOne(selection.uid, {
          uid: true,
          headers: true,
          envelope: true
        }, { uid: true });
        if (!message || !message.headers)
          throw new Error("The selected Inbox message no longer exists");

        const envelope = message.envelope || {};
        const senders = envelope.from || envelope.sender || [];
        const recipients = [
          ...(envelope.to || []),
          ...(envelope.cc || [])
        ];
        const senderAddress = `${senders[0]?.address || ""}`.trim();

        return {
          id,
          headers: message.headers.toString("utf8").replace(/\r?\n$/, ""),
          sender: senders.map(formatAddress).join(", "),
          senderAddress,
          senderDomain: senderAddress.includes("@")
            ? senderAddress.slice(senderAddress.lastIndexOf("@") + 1).toLocaleLowerCase()
            : "",
          recipients: recipients.map(formatAddress),
          recipientAddresses: [...new Set(recipients
            .map((address) => { return `${address.address || ""}`.trim(); })
            .filter(Boolean))],
          subject: envelope.subject || "",
          messageId: envelope.messageId || ""
        };
      } finally {
        lock.release();
      }
    });
  }

  /**
   * Finds Inbox UIDs with the same Message-ID header.
   *
   * @param {object} client
   *   connected ImapFlow client.
   * @param {string} inbox
   *   Inbox path.
   * @param {string} messageId
   *   RFC 822 Message-ID.
   * @returns {Promise<number[]>}
   *   matching UIDs.
   */
  async findInboxDuplicates(client, inbox, messageId) {
    if (!messageId)
      return [];

    const lock = await client.getMailboxLock(inbox);
    try {
      return await client.search({ header: { "message-id": messageId } }, { uid: true }) || [];
    } finally {
      lock.release();
    }
  }

  /**
   * Fetches one selected source message from Junk.
   *
   * @param {object} client
   *   connected ImapFlow client.
   * @param {string} junk
   *   Junk path.
   * @param {{uidValidity: string, uid: number}} selection
   *   selected message identity.
   * @returns {Promise<object>}
   *   full IMAP message.
   */
  async fetchSource(client, junk, selection) {
    const lock = await client.getMailboxLock(junk);
    try {
      if (`${client.mailbox.uidValidity}` !== selection.uidValidity)
        throw new Error("The Spam folder changed; refresh the message list and try again");

      const message = await client.fetchOne(selection.uid, {
        uid: true,
        source: true,
        flags: true,
        internalDate: true,
        envelope: true
      }, { uid: true });

      if (!message || !message.source)
        throw new Error("The selected spam message no longer exists");

      return message;
    } finally {
      lock.release();
    }
  }

  /**
   * Deletes UID values from a selected mailbox.
   *
   * @param {object} client
   *   connected ImapFlow client.
   * @param {string} mailbox
   *   mailbox path.
   * @param {number[]} uids
   *   UIDs to delete.
   */
  async deleteUids(client, mailbox, uids) {
    if (!uids.length)
      return;

    const lock = await client.getMailboxLock(mailbox);
    try {
      if (!await client.messageDelete(uids, { uid: true }))
        throw new Error(`IMAP could not remove the previous copy from ${mailbox}`);
    } finally {
      lock.release();
    }
  }

  /**
   * Cleans and restores the selected Junk messages into Inbox.
   * Existing Inbox messages with the same Message-ID are removed only after
   * the replacement has been appended successfully.
   *
   * @param {string[]} messageIds
   *   opaque message selection identifiers.
   * @param {boolean} permanentAllow
   *   additionally queue authenticated permanent sender allowlisting.
   * @returns {Promise<{processed: number}>}
   *   operation summary.
   */
  async unspam(messageIds, permanentAllow) {
    return await this.withClient(async (client) => {
      const folders = resolveSpamFolders(await client.list());
      let processed = 0;

      for (const id of messageIds) {
        const selection = parseMessageId(id);
        const source = await this.fetchSource(client, folders.junk, selection);
        const messageId = source.envelope?.messageId || "";
        const existing = await this.findInboxDuplicates(
          client, folders.inbox, messageId);
        const cleaned = cleanSpamMessage(new Uint8Array(source.source));
        const appended = await client.append(
          folders.inbox,
          Buffer.from(cleaned.data),
          getCleanFlags(source.flags, permanentAllow),
          source.internalDate);

        if (!appended)
          throw new Error("IMAP did not confirm the cleaned Inbox copy");

        const after = !appended.uid && messageId
          ? await this.findInboxDuplicates(client, folders.inbox, messageId)
          : [];
        const appendedUid = appended.uid || after.find((uid) => {
          return !existing.includes(uid);
        });
        if (!appendedUid)
          throw new Error("IMAP could not verify the cleaned Inbox copy");

        await this.deleteUids(client, folders.junk, [selection.uid]);
        await this.deleteUids(client, folders.inbox,
          existing.filter((uid) => { return uid !== appendedUid; }));
        processed++;
      }

      return { processed };
    });
  }
}

export {
  createMessageId,
  formatAddress,
  getSelectableMailboxPaths,
  getCleanFlags,
  parseMessageId,
  resolveInboxFolder,
  resolveSpamFolders,
  SieveImapSpamClient
};
