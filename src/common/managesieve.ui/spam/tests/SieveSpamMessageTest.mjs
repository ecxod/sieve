/* global net */

const suite = net.tschmid.yautt.test;

if (!suite)
  throw new Error("Could not initialize test suite");

import {
  binaryStringToBytes,
  cleanSpamMessage,
  findSpecialFolder,
  matchesSpamSearch,
  replaceDuplicateMessages
} from "./../SieveSpamMessage.mjs";
import {
  getCleanFlags,
  resolveSpamFolders,
  SieveImapSpamClient
} from "./../SieveImapSpamClient.mjs";
import {
  appendSpamRuleToScript,
  createSpamRule,
  findSpamRuleMatches,
  quoteSieve
} from "./../SieveSpamRule.mjs";

/**
 *
 * @param bytes
 */
function asBinaryString(bytes) {
  return Array.from(bytes, (value) => {return String.fromCharCode(value);}).join("");
}

suite.add("Spam cleanup removes Rspamd prefix and verdict headers", function () {
  const source = [
    "From: Sender <sender@example.test>",
    "Subject: *****[SPAM](6.42)***** An invoice",
    "X-Spam: true",
    "X-Spam-Status: Yes, score=6.42 required=5.0",
    "\ttests=TEST_ONE,TEST_TWO",
    "X-Rspamd-Queue-Id: abc123",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Body stays *****[SPAM](6.42)***** untouched."
  ].join("\r\n");
  const result = cleanSpamMessage(binaryStringToBytes(source));
  const cleaned = asBinaryString(result.data);

  suite.assertTrue(result.subjectChanged);
  suite.assertEquals(result.headersRemoved, 3);
  suite.assertTrue(cleaned.includes("Subject: An invoice\r\n"));
  suite.assertFalse(cleaned.includes("X-Spam-Status:"));
  suite.assertTrue(cleaned.endsWith("Body stays *****[SPAM](6.42)***** untouched."));
});

suite.add("Spam cleanup preserves non-spam source bytes", function () {
  const source = binaryStringToBytes(
    "Subject: Ordinary message\nContent-Type: application/octet-stream\n\n");
  const payload = new Uint8Array([...source, 0x00, 0x80, 0xff]);
  const result = cleanSpamMessage(payload);

  suite.assertFalse(result.subjectChanged);
  suite.assertEquals(result.headersRemoved, 0);
  suite.assertEquals(result.data.length, payload.length);
  suite.assertEquals(result.data[result.data.length - 1], 0xff);
});

suite.add("Special folders support legacy and current account shapes", function () {
  const inbox = { name: "Inbox", specialUse: ["inbox"] };
  const junk = { name: "Spam", type: "junk" };
  const account = {
    rootFolder: {
      subFolders: [inbox, { name: "Other", subFolders: [junk] }]
    }
  };

  suite.assertEquals(findSpecialFolder(account, "inbox"), inbox);
  suite.assertEquals(findSpecialFolder(account, "junk"), junk);
  suite.assertEquals(findSpecialFolder(account, "sent"), null);
});

suite.add("Spam search matches subject sender and recipients", function () {
  const message = {
    subject: "Quarterly invoice",
    author: "Alice <alice@example.test>",
    recipients: ["Bob <bob@example.test>"]
  };

  suite.assertTrue(matchesSpamSearch(message, "INVOICE"));
  suite.assertTrue(matchesSpamSearch(message, "alice@"));
  suite.assertTrue(matchesSpamSearch(message, "bob@"));
  suite.assertFalse(matchesSpamSearch(message, "charlie"));
});

suite.add("Duplicate replacement imports directly when Inbox is clear", async function () {
  const calls = [];
  const imported = await replaceDuplicateMessages({
    hasDuplicates: false,
    createBackup: async () => { calls.push("backup"); },
    removeDuplicates: async () => { calls.push("remove"); },
    importReplacement: async () => {
      calls.push("import");
      return "replacement";
    },
    restoreBackup: async () => { calls.push("restore"); }
  });

  suite.assertEquals(imported, "replacement");
  suite.assertEquals(calls.join(","), "import");
});

suite.add("Duplicate replacement backs up before replacing", async function () {
  const calls = [];
  const imported = await replaceDuplicateMessages({
    hasDuplicates: true,
    createBackup: async () => {
      calls.push("backup");
      return "previous";
    },
    removeDuplicates: async () => { calls.push("remove"); },
    importReplacement: async () => {
      calls.push("import");
      return "replacement";
    },
    restoreBackup: async () => { calls.push("restore"); }
  });

  suite.assertEquals(imported, "replacement");
  suite.assertEquals(calls.join(","), "backup,remove,import");
});

suite.add("Duplicate replacement restores the Inbox copy after import failure", async function () {
  const calls = [];
  let error = null;
  try {
    await replaceDuplicateMessages({
      hasDuplicates: true,
      createBackup: async () => {
        calls.push("backup");
        return "previous";
      },
      removeDuplicates: async () => { calls.push("remove"); },
      importReplacement: async () => {
        calls.push("import");
        throw new Error("duplicate import failed");
      },
      restoreBackup: async (backup) => { calls.push(`restore:${backup}`); }
    });
  } catch (ex) {
    error = ex;
  }

  suite.assertEquals(error.message, "duplicate import failed");
  suite.assertEquals(calls.join(","), "backup,remove,import,restore:previous");
});

suite.add("IMAP special-use folders and ham keywords are resolved", function () {
  const folders = resolveSpamFolders([
    { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
    { path: "Junk E-mail", name: "Junk E-mail", specialUse: "\\Junk" }
  ]);
  const flags = getCleanFlags(
    new Set(["\\Seen", "\\Deleted", "$Junk", "custom"]), true);

  suite.assertEquals(folders.inbox, "INBOX");
  suite.assertEquals(folders.junk, "Junk E-mail");
  suite.assertTrue(flags.includes("\\Seen"));
  suite.assertTrue(flags.includes("custom"));
  suite.assertTrue(flags.includes("$NotJunk"));
  suite.assertTrue(flags.includes("rspamdham"));
  suite.assertTrue(flags.includes("rspamdallow"));
  suite.assertFalse(flags.includes("\\Deleted"));
  suite.assertFalse(flags.includes("$Junk"));
});

suite.add("Direct IMAP restore appends before deleting source and duplicates", async function () {
  const calls = [];
  const mailboxes = [
    { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
    { path: "Spam", name: "Spam", specialUse: "\\Junk" }
  ];
  const client = {
    usable: true,
    mailbox: false,
    connect: async () => { calls.push("connect"); },
    logout: async () => { calls.push("logout"); },
    close: () => { calls.push("close"); },
    list: async () => { return mailboxes; },
    getMailboxLock: async (path) => {
      client.mailbox = {
        uidValidity: path === "Spam" ? 7n : 8n,
        exists: 1
      };
      return { release: () => { calls.push(`release:${path}`); } };
    },
    fetchOne: async () => {
      return {
        uid: 20,
        source: Buffer.from("Subject: [SPAM] Hello\r\n\r\nBody"),
        flags: new Set(["\\Seen", "$Junk"]),
        internalDate: new Date("2026-08-25T10:00:00Z"),
        envelope: { messageId: "<same@example.test>" }
      };
    },
    search: async () => { return [10]; },
    append: async (path, source, flags) => {
      calls.push(`append:${path}`);
      suite.assertTrue(source.toString().includes("Subject: Hello"));
      suite.assertTrue(flags.includes("rspamdham"));
      return { uid: 11 };
    },
    messageDelete: async (uids) => {
      calls.push(`delete:${client.mailbox.uidValidity}:${uids.join(",")}`);
      return true;
    }
  };
  const service = new SieveImapSpamClient(() => { return client; });
  const result = await service.unspam(["7:20"], false);

  suite.assertEquals(result.processed, 1);
  suite.assertTrue(calls.indexOf("append:INBOX") < calls.indexOf("delete:7:20"));
  suite.assertTrue(calls.indexOf("append:INBOX") < calls.indexOf("delete:8:10"));
  suite.assertEquals(calls[calls.length - 1], "logout");
});

suite.add("Spam rule generation quotes values and requires fileinto", function () {
  const rule = createSpamRule({
    senderAddress: "Sales@Example.Test",
    senderDomain: "example.test",
    recipientAddresses: ["customer@example.test"],
    subject: "A \"special\" offer"
  }, {
    criteria: ["sender", "subject"],
    action: "fileinto",
    mailbox: "Allowed/Offers"
  });

  suite.assertTrue(rule.sieve.startsWith("require [\"fileinto\"];"));
  suite.assertTrue(rule.sieve.includes("allof("));
  suite.assertTrue(rule.sieve.includes("sales@example.test"));
  suite.assertTrue(rule.sieve.includes("A \\\"special\\\" offer"));
  suite.assertTrue(rule.sieve.includes("fileinto \"Allowed/Offers\";"));
  suite.assertEquals(quoteSieve("a\\b\"c"), "\"a\\\\b\\\"c\"");
});

suite.add("Spam rule generation supports keep without extensions", function () {
  const rule = createSpamRule({
    senderAddress: "person@example.test",
    senderDomain: "example.test",
    recipientAddresses: []
  }, {
    criteria: ["domain"],
    action: "keep"
  });

  suite.assertEquals(rule.requirements.length, 0);
  suite.assertFalse(rule.sieve.includes("require"));
  suite.assertTrue(rule.sieve.includes("address :domain :is \"from\" \"example.test\""));
  suite.assertTrue(rule.sieve.includes("  keep;\n  stop;"));
});

suite.add("Spam rule appending preserves content and refuses duplicates", function () {
  const rule = createSpamRule({
    senderAddress: "person@example.test",
    senderDomain: "example.test",
    recipientAddresses: []
  }, {
    criteria: ["sender"],
    action: "fileinto",
    mailbox: "INBOX"
  });
  const updated = appendSpamRuleToScript("# Existing rule\nkeep;\n", rule);

  suite.assertTrue(updated.startsWith("require [\"fileinto\"];\n# Existing rule"));
  suite.assertTrue(updated.includes("# Existing rule\nkeep;\n\n# BEGIN sieve-spam-rule"));
  let error = null;
  try {
    appendSpamRuleToScript(updated, rule);
  } catch (ex) {
    error = ex;
  }
  suite.assertTrue(!!error);
  suite.assertTrue(error.message.includes("already exists"));
});

suite.add("Spam rule search reports shared parameters and source lines", function () {
  const matches = findSpamRuleMatches([{
    name: "active-filter",
    active: true,
    content: [
      "require [\"fileinto\"];",
      "if address :is \"from\" \"person@example.test\" {",
      "  fileinto \"INBOX\";",
      "}"
    ].join("\n")
  }, {
    name: "other-filter",
    active: false,
    content: "if header :contains \"Subject\" \"unrelated\" { keep; }"
  }], {
    senderAddress: "person@example.test",
    senderDomain: "example.test",
    recipientAddresses: ["customer@example.test"],
    subject: "Expected subject"
  });

  suite.assertEquals(matches.length, 1);
  suite.assertEquals(matches[0].name, "active-filter");
  suite.assertTrue(matches[0].active);
  suite.assertEquals(matches[0].matches[0].type, "sender");
  suite.assertEquals(matches[0].matches[0].occurrences[0].line, 2);
});

suite.add("Direct IMAP details returns raw headers and rule parameters", async function () {
  const calls = [];
  const client = {
    usable: true,
    mailbox: false,
    connect: async () => { calls.push("connect"); },
    logout: async () => { calls.push("logout"); },
    close: () => { calls.push("close"); },
    list: async () => {
      return [
        { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
        { path: "Spam", name: "Spam", specialUse: "\\Junk" }
      ];
    },
    getMailboxLock: async () => {
      client.mailbox = { uidValidity: 7n, exists: 1 };
      return { release: () => { calls.push("release"); } };
    },
    fetchOne: async () => {
      return {
        headers: Buffer.from("From: Person <person@example.test>\r\nSubject: Hello\r\n\r\n"),
        envelope: {
          from: [{ name: "Person", address: "person@example.test" }],
          to: [{ name: "Customer", address: "customer@example.test" }],
          cc: [{ address: "copy@example.test" }],
          subject: "Hello",
          messageId: "<message@example.test>"
        }
      };
    }
  };
  const service = new SieveImapSpamClient(() => { return client; });
  const details = await service.getDetails("7:20");

  suite.assertTrue(details.headers.includes("Subject: Hello"));
  suite.assertEquals(details.senderAddress, "person@example.test");
  suite.assertEquals(details.senderDomain, "example.test");
  suite.assertEquals(details.recipientAddresses.length, 2);
  suite.assertEquals(details.subject, "Hello");
  suite.assertEquals(calls.join(","), "connect,release,logout");
});
