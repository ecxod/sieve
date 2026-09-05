/* global net */

const suite = net.tschmid.yautt.test;

if (!suite)
  throw new Error("Could not initialize test suite");

import {
  chunkUidSet,
  compactUidSet,
  parseInboxMessageId,
  resolveInboxFolder,
  resolveSentFolder,
  SieveImapFilterClient
} from "./../SieveImapFilterClient.mjs";
import {
  parseSearchUids,
  quoteImap,
  SieveMozImapFilterClient
} from "./../SieveMozImapFilterClient.mjs";
import {
  listThunderbirdFolderMessages
} from "./../SieveThunderbirdMessageList.mjs";

suite.add("Thunderbird message listing uses MailFolderId and follows pages", async function () {
  const calls = [];
  const messages = await listThunderbirdFolderMessages({
    async list(folderId) {
      calls.push(`list:${folderId}`);
      return { id: "page-2", messages: [{ id: 1 }] };
    },
    async continueList(pageId) {
      calls.push(`continue:${pageId}`);
      return { messages: [{ id: 2 }] };
    }
  }, { id: "account1://INBOX", name: "Inbox" });

  suite.assertEquals(calls.join(","),
    "list:account1://INBOX,continue:page-2");
  suite.assertEquals(messages.map((message) => { return message.id; }).join(","), "1,2");
  let error = null;
  try {
    await listThunderbirdFolderMessages({ list() {} }, { name: "Inbox" });
  } catch (ex) {
    error = ex;
  }
  suite.assertEquals(error?.message, "Thunderbird did not provide a MailFolderId");
});

suite.add("IMAP Sent filter helpers resolve and compact selections", function () {
  suite.assertEquals(resolveSentFolder([
    { path: "Archive", specialUse: "\\Archive" },
    { path: "Sent Items", specialUse: "\\Sent" }
  ]), "Sent Items");
  suite.assertEquals(compactUidSet([7, 3, 4, 5, 7, 10]), "3:5,7,10");
  suite.assertEquals(chunkUidSet([1, 3, 5], 3).join("|"), "1,3|5");
});

suite.add("Inbox filter helpers validate exact message selections", function () {
  suite.assertEquals(resolveInboxFolder([
    { path: "Archive", specialUse: "\\Archive" },
    { path: "INBOX", specialUse: "\\Inbox" }
  ]), "INBOX");
  suite.assertEquals(parseInboxMessageId("42:123").uidValidity, "42");
  suite.assertEquals(parseInboxMessageId("42:123").uid, 123);
  suite.assertThrows(
    () => { parseInboxMessageId("42:* "); },
    "The selected Inbox message identifier is invalid");
});

suite.add("Raw IMAP helpers escape values and parse SEARCH", function () {
  suite.assertEquals(quoteImap('Sent "2026"\\A'), '"Sent \\"2026\\"\\\\A"');
  suite.assertEquals(
    parseSearchUids(["* SEARCH 9 3 9 4", "S0001 OK SEARCH done"]).join(","),
    "3,4,9");
});

suite.add("IMAP Sent filter uses PERSONAL script and exact UID criteria", async function () {
  const commands = [];
  let connections = 0;
  const createClient = () => {
    connections++;
    return {
      capabilities: new Map([["FILTER=SIEVE", true]]),
      usable: true,
      mailbox: null,
      async connect() {},
      async logout() {},
      async list() {
        return [{ path: "Sent", specialUse: "\\Sent" }];
      },
      async getMailboxLock(folder) {
        this.mailbox = { uidValidity: 42n };
        suite.assertEquals(folder, "Sent");
        return { release() {} };
      },
      async search() {
        return [7, 8, 12];
      },
      async exec(command, attributes, options) {
        commands.push({ command, attributes });
        await options.untagged.FILTERED({
          attributes: [{ value: "FILTERED" }, { value: "WARNINGS" }],
          next() {}
        });
        return { next() {} };
      }
    };
  };
  const filter = new SieveImapFilterClient(createClient);
  const snapshot = await filter.prepare();
  const result = await filter.apply("outgoing", snapshot);

  suite.assertEquals(connections, 2);
  suite.assertEquals(commands[0].command, "UID FILTER");
  suite.assertEquals(
    commands[0].attributes.map((item) => { return item.value; }).join(" "),
    "SIEVE PERSONAL outgoing UID 7:8,12");
  suite.assertEquals(result.selected, 3);
  suite.assertEquals(result.filtered, 1);
  suite.assertEquals(result.warnings, 1);
  suite.assertEquals(result.errors, 0);
  suite.assertTrue(result.reports[0].includes("FILTERED WARNINGS"));
});

suite.add("Direct IMAP filter creates literal destination mailboxes", async function () {
  const created = [];
  const filter = new SieveImapFilterClient(() => {
    return {
      capabilities: new Map([["FILTER=SIEVE", true]]),
      usable: true,
      async connect() {},
      async logout() {},
      async mailboxCreate(mailbox) {
        created.push(mailbox);
        return { path: mailbox, created: mailbox !== "Existing" };
      }
    };
  });

  const result = await filter.ensureMailboxes([
    "INBOX", "Existing", "New", "New"
  ]);
  suite.assertEquals(created.join(","), "Existing,New");
  suite.assertEquals(result.join(","), "New");
});

suite.add("Direct IMAP Inbox filter verifies UIDVALIDITY and the selected UID", async function () {
  const createClient = () => {
    return {
      capabilities: new Map([["FILTER=SIEVE", true]]),
      usable: true,
      mailbox: null,
      async connect() {},
      async logout() {},
      async list() {
        return [{ path: "INBOX", specialUse: "\\Inbox" }];
      },
      async getMailboxLock(folder, options) {
        suite.assertEquals(folder, "INBOX");
        suite.assertTrue(options.readOnly);
        this.mailbox = { uidValidity: 42n };
        return { release() {} };
      },
      async search(query, options) {
        suite.assertEquals(query.uid, "123");
        suite.assertFalse(query.deleted);
        suite.assertTrue(options.uid);
        return [123];
      }
    };
  };
  const filter = new SieveImapFilterClient(createClient);
  const snapshot = await filter.prepareInbox("42:123");

  suite.assertEquals(snapshot.folder, "INBOX");
  suite.assertEquals(snapshot.uidValidity, "42");
  suite.assertEquals(snapshot.uids.join(","), "123");
});

suite.add("Electron Inbox filter safely expunges only the selected UID", async function () {
  const commands = [];
  const createClient = () => {
    return {
      capabilities: new Map([
        ["FILTER=SIEVE", true],
        ["UIDPLUS", true]
      ]),
      usable: true,
      mailbox: null,
      async connect() {},
      async logout() {},
      async getMailboxLock(folder) {
        suite.assertEquals(folder, "INBOX");
        this.mailbox = { uidValidity: 77n };
        return { release() {} };
      },
      async exec(command, attributes, options) {
        commands.push({ command, attributes });
        if (command === "UID FILTER") {
          await options.untagged.FILTERED({
            attributes: [{ value: "FILTERED" }],
            next() {}
          });
        }
        return { next() {} };
      }
    };
  };
  const filter = new SieveImapFilterClient(createClient);
  const result = await filter.apply("active", {
    folder: "INBOX",
    uidValidity: "77",
    uids: [9]
  }, { expunge: true });

  suite.assertEquals(commands[0].command, "UID FILTER");
  suite.assertEquals(commands[1].command, "UID EXPUNGE");
  suite.assertEquals(commands[1].attributes[0].value, "9");
  suite.assertTrue(result.expunged);
});

suite.add("Electron Inbox filter requires UIDPLUS before filtering", async function () {
  let filtered = false;
  const filter = new SieveImapFilterClient(() => {
    return {
      capabilities: new Map([["FILTER=SIEVE", true]]),
      usable: true,
      async connect() {},
      async logout() {},
      async exec() { filtered = true; }
    };
  });

  let error = null;
  try {
    await filter.apply("active", {
      folder: "INBOX",
      uidValidity: "77",
      uids: [9]
    }, { expunge: true });
  } catch (ex) {
    error = ex;
  }
  suite.assertTrue(error?.message.includes("UIDPLUS"));
  suite.assertFalse(filtered);
});

suite.add("Thunderbird Inbox filter resolves one Message-ID to the newest UID", async function () {
  const commands = [];
  const filter = new SieveMozImapFilterClient({});
  filter.withConnection = async (callback) => {
    return await callback({
      async command(command) {
        commands.push(command);
        if (command.startsWith("SELECT"))
          return ["* OK [UIDVALIDITY 77] selected", "S0001 OK SELECT done"];
        return ["* SEARCH 8 11 9", "S0002 OK SEARCH done"];
      }
    });
  };

  const snapshot = await filter.prepareInbox("/INBOX", "<newest@example.test>");
  suite.assertEquals(commands[0], 'SELECT "INBOX"');
  suite.assertEquals(
    commands[1],
    'UID SEARCH UNDELETED HEADER Message-ID "<newest@example.test>"');
  suite.assertEquals(snapshot.uidValidity, "77");
  suite.assertEquals(snapshot.uids.join(","), "11");
});

suite.add("Thunderbird filter creates missing mailboxes and exposes server reports", async function () {
  const commands = [];
  const filter = new SieveMozImapFilterClient({});
  filter.withConnection = async (callback) => {
    return await callback({
      async command(command) {
        commands.push(command);
        if (command === 'CREATE "Existing"')
          throw new Error("S0001 NO [ALREADYEXISTS] mailbox exists");
        if (command.startsWith("SELECT"))
          return ["* OK [UIDVALIDITY 77] selected", "S0002 OK SELECT done"];
        return [
          "* 9 FILTERED (WARNINGS (fileinto completed))",
          "S0003 OK FILTER done"
        ];
      }
    });
  };

  const created = await filter.ensureMailboxes(["INBOX", "Existing", "New"]);
  const result = await filter.apply("active", {
    folder: "INBOX",
    uidValidity: "77",
    uids: [9]
  });
  suite.assertEquals(created.join(","), "New");
  suite.assertTrue(commands.includes('CREATE "New"'));
  suite.assertEquals(result.filtered, 1);
  suite.assertEquals(result.warnings, 1);
  suite.assertTrue(result.reports[0].includes("fileinto completed"));
});

suite.add("Thunderbird Inbox filter safely expunges only the selected UID", async function () {
  const commands = [];
  const filter = new SieveMozImapFilterClient({});
  filter.withConnection = async (callback) => {
    return await callback({
      capabilitySet: new Set(["FILTER=SIEVE", "UIDPLUS"]),
      async command(command) {
        commands.push(command);
        if (command.startsWith("SELECT"))
          return ["* OK [UIDVALIDITY 77] selected", "S0001 OK SELECT done"];
        if (command.startsWith("UID FILTER"))
          return ["* 9 FILTERED", "S0002 OK FILTER done"];
        return ["* 9 EXPUNGE", "S0003 OK UID EXPUNGE done"];
      }
    });
  };

  const result = await filter.apply("active", {
    folder: "INBOX",
    uidValidity: "77",
    uids: [9]
  }, { expunge: true });
  suite.assertEquals(commands.at(-1), "UID EXPUNGE 9");
  suite.assertTrue(result.expunged);
});

suite.add("Thunderbird Inbox filter requires UIDPLUS before filtering", async function () {
  const commands = [];
  const filter = new SieveMozImapFilterClient({});
  filter.withConnection = async (callback) => {
    return await callback({
      capabilitySet: new Set(["FILTER=SIEVE"]),
      async command(command) {
        commands.push(command);
        return [];
      }
    });
  };

  let error = null;
  try {
    await filter.apply("active", {
      folder: "INBOX",
      uidValidity: "77",
      uids: [9]
    }, { expunge: true });
  } catch (ex) {
    error = ex;
  }
  suite.assertTrue(error?.message.includes("UIDPLUS"));
  suite.assertEquals(commands.length, 0);
});
