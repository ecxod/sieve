/*
 * Minimal raw IMAP client for Thunderbird's privileged socket Experiment.
 * It deliberately implements only the commands needed by FILTER=SIEVE.
 */

/* global browser */

import { chunkUidSet } from "./SieveImapFilterClient.mjs";

const COMMAND_TIMEOUT = 30000;
const FILTER_CAPABILITY = "FILTER=SIEVE";

/**
 * Escapes one IMAP quoted string.
 *
 * @param {string} value
 *   string value.
 * @returns {string}
 *   IMAP quoted string.
 */
function quoteImap(value) {
  value = `${value}`;
  if (/\0|\r|\n/.test(value))
    throw new Error("IMAP values must not contain NUL or line breaks");
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

/**
 * Parses UIDs from an untagged SEARCH response.
 *
 * @param {string[]} lines
 *   command response lines.
 * @returns {number[]}
 *   sorted positive UIDs.
 */
function parseSearchUids(lines) {
  const uids = [];
  for (const line of lines) {
    const match = /^\* SEARCH(?: (.*))?$/i.exec(line);
    if (!match || !match[1])
      continue;
    for (const value of match[1].trim().split(/\s+/)) {
      const uid = Number.parseInt(value, 10);
      if (Number.isSafeInteger(uid) && uid > 0)
        uids.push(uid);
    }
  }
  return [...new Set(uids)].sort((a, b) => { return a - b; });
}

/**
 * One raw authenticated IMAP connection.
 */
class SieveMozImapConnection {

  /**
   * @param {object} settings
   *   host, port, security and credentials.
   */
  constructor(settings) {
    this.settings = settings;
    this.socket = null;
    this.tag = 0;
    this.pending = null;
    this.greeting = null;
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
    this.buffer = "";
    this.preauthenticated = false;
    this.onData = (bytes) => { this.receive(bytes); };
    this.onError = (error) => {
      this.fail(new Error(error?.message || "The IMAP socket failed"));
    };
    this.onClose = () => {
      this.fail(new Error("The IMAP server closed the connection"));
    };
  }

  /**
   * Rejects the currently awaited protocol operation.
   *
   * @param {Error} error
   *   connection error.
   */
  fail(error) {
    if (this.greeting) {
      this.greeting.reject(error);
      this.greeting = null;
    }
    if (this.pending) {
      this.pending.reject(error);
      this.pending = null;
    }
  }

  /**
   * Feeds bytes into the line parser.
   *
   * @param {number[]} bytes
   *   socket bytes.
   */
  receive(bytes) {
    this.buffer += this.decoder.decode(new Uint8Array(bytes), { stream: true });
    let offset = this.buffer.indexOf("\r\n");
    while (offset >= 0) {
      const line = this.buffer.slice(0, offset);
      this.buffer = this.buffer.slice(offset + 2);
      this.receiveLine(line);
      offset = this.buffer.indexOf("\r\n");
    }
  }

  /**
   * Handles one complete IMAP response line.
   *
   * @param {string} line
   *   response line.
   */
  receiveLine(line) {
    if (this.greeting) {
      if (/^\* PREAUTH\b/i.test(line)) {
        this.preauthenticated = true;
        this.greeting.resolve();
        this.greeting = null;
        return;
      }
      if (/^\* OK\b/i.test(line)) {
        this.greeting.resolve();
        this.greeting = null;
        return;
      }
      if (/^\* BYE\b/i.test(line))
        this.fail(new Error(line));
      return;
    }

    if (!this.pending)
      return;

    this.pending.lines.push(line);
    const completion = new RegExp(
      `^${this.pending.tag} (OK|NO|BAD)(?: |$)`, "i").exec(line);
    if (!completion)
      return;

    const pending = this.pending;
    this.pending = null;
    if (completion[1].toUpperCase() === "OK")
      pending.resolve(pending.lines);
    else
      pending.reject(new Error(line));
  }

  /**
   * Opens, secures and authenticates the connection.
   */
  async connect() {
    const creation = JSON.parse(await browser.sieve.socketV4.create(
      this.settings.hostname, `${this.settings.port}`, this.settings.security));
    if (creation.error)
      throw new Error(creation.error);
    this.socket = creation.id;

    await browser.sieve.socketV4.onData.addListener(this.onData, this.socket);
    await browser.sieve.socketV4.onError.addListener(this.onError, this.socket);
    await browser.sieve.socketV4.onClose.addListener(this.onClose, this.socket);

    const greeting = new Promise((resolve, reject) => {
      this.greeting = { resolve, reject };
    });
    await browser.sieve.socketV4.connect(this.socket);
    await this.withTimeout(greeting, "Waiting for the IMAP greeting");

    if (this.settings.security === "starttls") {
      const capabilities = await this.capabilities();
      if (!capabilities.has("STARTTLS"))
        throw new Error("The IMAP server does not offer STARTTLS");
      await this.command("STARTTLS");
      const result = JSON.parse(
        await browser.sieve.socketV4.startTLS(this.socket));
      if (!result.ok)
        throw new Error(result.error || "The IMAP TLS upgrade failed");
    }

    if (!this.preauthenticated) {
      if (!this.settings.password)
        throw new Error("Thunderbird has no saved IMAP password for this account");
      await this.command(
        `LOGIN ${quoteImap(this.settings.username)} ${quoteImap(this.settings.password)}`);
    }

    const capabilities = await this.capabilities();
    if (!capabilities.has(FILTER_CAPABILITY))
      throw new Error("The IMAP server does not offer FILTER=SIEVE");
  }

  /**
   * Adds a timeout to one protocol wait.
   *
   * @param {Promise} promise
   *   protocol promise.
   * @param {string} stage
   *   human-readable stage.
   * @returns {Promise<*>}
   *   settled protocol value.
   */
  async withTimeout(promise, stage) {
    let timeout = null;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`${stage} timed out`));
          }, COMMAND_TIMEOUT);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Sends one tagged IMAP command.
   *
   * @param {string} command
   *   command without tag.
   * @returns {Promise<string[]>}
   *   all response lines through tagged completion.
   */
  async command(command) {
    if (this.pending)
      throw new Error("An IMAP command is already running");

    const tag = `S${`${++this.tag}`.padStart(4, "0")}`;
    const response = new Promise((resolve, reject) => {
      this.pending = { tag, lines: [], resolve, reject };
    });
    await browser.sieve.socketV4.send(
      this.socket, [...this.encoder.encode(`${tag} ${command}\r\n`)]);
    return await this.withTimeout(response, `IMAP ${command.split(" ")[0]}`);
  }

  /**
   * Retrieves server capabilities.
   *
   * @returns {Promise<Set<string>>}
   *   uppercase capabilities.
   */
  async capabilities() {
    const lines = await this.command("CAPABILITY");
    const result = new Set();
    for (const line of lines) {
      const match = /^\* CAPABILITY (.*)$/i.exec(line);
      if (!match)
        continue;
      for (const value of match[1].split(/\s+/))
        result.add(value.toUpperCase());
    }
    return result;
  }

  /**
   * Closes and destroys the privileged socket.
   */
  async close() {
    if (!this.socket)
      return;
    try {
      if (!this.pending)
        await this.command("LOGOUT");
    } catch {
      // Best-effort logout; destroy below is authoritative.
    }
    browser.sieve.socketV4.onData.removeListener(this.onData);
    browser.sieve.socketV4.onError.removeListener(this.onError);
    browser.sieve.socketV4.onClose.removeListener(this.onClose);
    await browser.sieve.socketV4.destroy(this.socket);
    this.socket = null;
  }
}

/**
 * FILTER=SIEVE adapter for Thunderbird-derived IMAP accounts.
 */
class SieveMozImapFilterClient {

  /**
   * @param {object} settings
   *   IMAP connection, credentials and Sent path.
   */
  constructor(settings) {
    this.settings = settings;
  }

  /**
   * Runs an operation with one raw IMAP connection.
   *
   * @param {Function} callback
   *   connected operation.
   * @returns {Promise<*>}
   *   callback result.
   */
  async withConnection(callback) {
    const connection = new SieveMozImapConnection(this.settings);
    try {
      await connection.connect();
      return await callback(connection);
    } finally {
      await connection.close();
    }
  }

  /**
   * Takes a snapshot of non-deleted Sent messages.
   *
   * @returns {Promise<object>}
   *   folder, UIDVALIDITY and UID selection.
   */
  async prepare() {
    return await this.withConnection(async (connection) => {
      const lines = await connection.command(
        `SELECT ${quoteImap(this.settings.sentFolder)}`);
      const validity = lines
        .map((line) => { return /\[UIDVALIDITY (\d+)\]/i.exec(line); })
        .find(Boolean);
      if (!validity)
        throw new Error("The IMAP server did not report UIDVALIDITY for Sent");

      return {
        folder: this.settings.sentFolder,
        uidValidity: validity[1],
        uids: parseSearchUids(await connection.command("UID SEARCH UNDELETED"))
      };
    });
  }

  /**
   * Resolves one selected Inbox message to its newest matching IMAP UID.
   *
   * Thunderbird's WebExtension message id is local, so the stable Message-ID
   * header is used at the raw IMAP boundary. Only one UID is selected even if
   * a server contains duplicate copies.
   *
   * @param {string} folder
   *   server-side Inbox path.
   * @param {string} messageId
   *   RFC Message-ID of the selected message.
   * @returns {Promise<object>}
   *   exact one-message snapshot.
   */
  async prepareInbox(folder, messageId) {
    folder = `${folder || ""}`.trim();
    messageId = `${messageId || ""}`.trim();
    if (!folder)
      throw new Error("Thunderbird did not report the server name of the Inbox");
    if (!messageId)
      throw new Error("The selected Inbox message has no Message-ID header");

    return await this.withConnection(async (connection) => {
      const lines = await connection.command(`SELECT ${quoteImap(folder)}`);
      const validity = lines
        .map((line) => { return /\[UIDVALIDITY (\d+)\]/i.exec(line); })
        .find(Boolean);
      if (!validity)
        throw new Error("The IMAP server did not report UIDVALIDITY for Inbox");

      const matches = parseSearchUids(await connection.command(
        `UID SEARCH UNDELETED HEADER Message-ID ${quoteImap(messageId)}`));
      if (!matches.length)
        throw new Error("The selected Inbox message is no longer available");

      return {
        folder,
        uidValidity: validity[1],
        uids: [matches[matches.length - 1]]
      };
    });
  }

  /**
   * Applies a personal script to an earlier UID snapshot.
   *
   * @param {string} script
   *   stored personal script name.
   * @param {object} snapshot
   *   result of prepare().
   * @returns {Promise<object>}
   *   operation counters.
   */
  async apply(script, snapshot) {
    const result = {
      selected: snapshot.uids.length,
      filtered: 0,
      warnings: 0,
      errors: 0
    };
    if (!snapshot.uids.length)
      return result;

    return await this.withConnection(async (connection) => {
      const select = await connection.command(`SELECT ${quoteImap(snapshot.folder)}`);
      const validity = select
        .map((line) => { return /\[UIDVALIDITY (\d+)\]/i.exec(line); })
        .find(Boolean);
      if (!validity || validity[1] !== snapshot.uidValidity) {
        throw new Error(
          "The selected folder was recreated after confirmation; no rule was applied");
      }

      for (const uids of chunkUidSet(snapshot.uids)) {
        const lines = await connection.command(
          `UID FILTER SIEVE PERSONAL ${quoteImap(script)} UID ${uids}`);
        for (const line of lines) {
          if (/^\* \d+ FILTERED\b/i.test(line)) {
            result.filtered++;
            if (/\bWARNINGS\b/i.test(line))
              result.warnings++;
            if (/\bERRORS\b/i.test(line))
              result.errors++;
          } else if (/^\* FILTER\b/i.test(line)) {
            if (/\bWARNINGS\b/i.test(line))
              result.warnings++;
            if (/\bERRORS\b/i.test(line))
              result.errors++;
          }
        }
      }
      return result;
    });
  }
}

export {
  parseSearchUids,
  quoteImap,
  SieveMozImapFilterClient
};
