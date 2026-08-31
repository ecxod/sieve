/* global net */

const suite = net.tschmid.yautt.test;

if (!suite)
  throw new Error("Could not initialize test suite");

import {
  chunkUidSet,
  compactUidSet,
  resolveSentFolder,
  SieveImapFilterClient
} from "./../SieveImapFilterClient.mjs";
import {
  parseSearchUids,
  quoteImap
} from "./../SieveMozImapFilterClient.mjs";

suite.add("IMAP Sent filter helpers resolve and compact selections", function () {
  suite.assertEquals(resolveSentFolder([
    { path: "Archive", specialUse: "\\Archive" },
    { path: "Sent Items", specialUse: "\\Sent" }
  ]), "Sent Items");
  suite.assertEquals(compactUidSet([7, 3, 4, 5, 7, 10]), "3:5,7,10");
  suite.assertEquals(chunkUidSet([1, 3, 5], 3).join("|"), "1,3|5");
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
