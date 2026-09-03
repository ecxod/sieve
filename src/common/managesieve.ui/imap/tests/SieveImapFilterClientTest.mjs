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

  const snapshot = await filter.prepareInbox("INBOX", "<newest@example.test>");
  suite.assertEquals(
    commands[1],
    'UID SEARCH UNDELETED HEADER Message-ID "<newest@example.test>"');
  suite.assertEquals(snapshot.uidValidity, "77");
  suite.assertEquals(snapshot.uids.join(","), "11");
});
