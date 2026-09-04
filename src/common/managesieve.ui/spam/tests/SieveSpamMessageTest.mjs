/* global net */

const suite = net.tschmid.yautt.test;

if (!suite)
  throw new Error("Could not initialize test suite");

import {
  binaryStringToBytes,
  cleanSpamMessage,
  extractEmailAddress,
  extractRawMessageHeaders,
  findSpecialFolder,
  matchesSpamSearch,
  replaceDuplicateMessages
} from "./../SieveSpamMessage.mjs";
import {
  getCleanFlags,
  getSelectableMailboxPaths,
  resolveInboxFolder,
  resolveSpamFolders,
  SieveImapSpamClient
} from "./../SieveImapSpamClient.mjs";
import {
  appendSpamRuleToScript,
  createSpamRule,
  findSpamRuleMatches,
  quoteSieve
} from "./../SieveSpamRule.mjs";
import {
  appendInboxRuleToScript,
  createInboxRuleTemplate,
  getLiteralFileintoMailboxes,
  getInboxRuleRequirements,
  inspectInboxRuleMailboxes,
  stripLeadingSieveRequirements
} from "./../../inbox/SieveInboxRule.mjs";
import {
  formatInboxDate,
  formatInboxRuleMatches,
  SieveInboxUI,
  sortInboxMessagesByDate
} from "./../../accounts/SieveInboxUI.mjs";
import {
  sortAccountsByDisplayName
} from "./../../accounts/SieveAccountSort.mjs";

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

suite.add("Inbox headers and display addresses are extracted safely", function () {
  const source = binaryStringToBytes([
    "From: Person <person@example.test>",
    "Subject: Encoded =?UTF-8?Q?subject?=",
    "\tcontinued",
    "",
    "Body: not a header"
  ].join("\r\n"));

  const headers = extractRawMessageHeaders(source);
  suite.assertTrue(headers.includes("Subject: Encoded"));
  suite.assertTrue(headers.includes("\r\n\tcontinued"));
  suite.assertFalse(headers.includes("Body: not a header"));
  suite.assertEquals(
    extractEmailAddress("Person <Person@Example.Test>"), "person@example.test");
  suite.assertEquals(extractEmailAddress("without an address"), "");
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

suite.add("Inbox and selectable IMAP folders are resolved independently", function () {
  const mailboxes = [
    { path: "INBOX", specialUse: "\\Inbox", flags: new Set() },
    { path: "Archive", flags: new Set() },
    { path: "Virtual", flags: new Set(["\\Noselect"]) }
  ];

  suite.assertEquals(resolveInboxFolder(mailboxes), "INBOX");
  suite.assertEquals(getSelectableMailboxPaths(mailboxes).join(","), "INBOX,Archive");
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

suite.add("Inbox rule template and append manage safe requirements", function () {
  const template = createInboxRuleTemplate({
    senderAddress: "Person@Example.Test",
    subject: "Expected subject"
  }, "Archive/Customers");

  suite.assertTrue(template.includes('address :is "from" "person@example.test"'));
  suite.assertTrue(template.includes('fileinto :create "Archive/Customers";'));
  suite.assertEquals(
    getInboxRuleRequirements(template).join(","), "fileinto,mailbox");

  const updated = appendInboxRuleToScript(
    'require "fileinto";\nkeep;\n', template);
  suite.assertTrue(updated.startsWith('require ["mailbox"];\nrequire "fileinto";'));
  suite.assertTrue(updated.includes("# BEGIN sieve-inbox-rule inbox-rule-"));
  suite.parseScript(updated, ["fileinto", "mailbox"]);

  suite.assertThrows(() => {
    appendInboxRuleToScript(updated, template);
  }, "This Inbox rule already exists in the selected script");
  suite.assertThrows(() => {
    appendInboxRuleToScript("keep;\n", [
      "# a leading comment must not hide a generated import",
      'require "fileinto";',
      'fileinto "INBOX";'
    ].join("\n"));
  }, "Do not add require commands here");
});

suite.add("Inbox graphical rule serialization removes generated requirements", function () {
  const graphical = [
    "# Created from Inbox: Expected subject",
    'require "mailbox";',
    'require ["fileinto"];',
    'if address :is "from" "person@example.test" {',
    '  fileinto :create "Archive/Customers";',
    "  stop;",
    "}"
  ].join("\r\n");
  const snippet = stripLeadingSieveRequirements(graphical);

  suite.assertFalse(snippet.includes("require"));
  suite.assertTrue(snippet.startsWith("# Created from Inbox:"));
  suite.assertTrue(snippet.includes('fileinto :create "Archive/Customers";'));

  const updated = appendInboxRuleToScript("keep;\n", snippet);
  suite.assertTrue(updated.startsWith('require ["fileinto", "mailbox"];'));
  suite.parseScript(updated, ["fileinto", "mailbox"]);

  const opaque = [
    "# No generated requirement section",
    "if true {",
    "  vacation text:",
    'require "this is message text";',
    ".",
    ";",
    "}"
  ].join("\n");
  suite.assertEquals(stripLeadingSieveRequirements(opaque), opaque);
});

suite.add("Inbox mailbox check ignores opaque fileinto text", function () {
  const snippet = [
    '# fileinto "Comment";',
    'if header :contains "Subject" "fileinto \\"String\\"" {',
    '  fileinto :copy :create "INBOX/Customers";',
    '}'
  ].join("\n");
  const existing = inspectInboxRuleMailboxes(
    snippet, ["INBOX", "INBOX/Customers"]);
  suite.assertEquals(existing.state, "ok");
  suite.assertEquals(existing.existing.join(","), "INBOX/Customers");
  suite.assertEquals(existing.missing.length, 0);
  suite.assertEquals(
    getInboxRuleRequirements(snippet).join(","), "fileinto,copy,mailbox");

  const missing = inspectInboxRuleMailboxes(
    'fileinto :create "Missing";', ["INBOX"]);
  suite.assertEquals(missing.state, "warning");
  suite.assertEquals(missing.missing[0], "Missing");
  suite.assertEquals(getLiteralFileintoMailboxes([
    '# fileinto "Ignored";',
    'fileinto "INBOX/Customers";',
    'fileinto :copy "INBOX/Customers";',
    'fileinto mailboxVariable;'
  ].join("\n")).join(","), "INBOX/Customers");
});

suite.add("Direct IMAP Inbox returns envelopes, folders and headers", async function () {
  const calls = [];
  const client = {
    usable: true,
    mailbox: false,
    connect: async () => { calls.push("connect"); },
    logout: async () => { calls.push("logout"); },
    close: () => { calls.push("close"); },
    list: async () => {
      return [
        { path: "INBOX", specialUse: "\\Inbox", flags: new Set() },
        { path: "Archive", flags: new Set() }
      ];
    },
    getMailboxLock: async () => {
      client.mailbox = { uidValidity: 9n, exists: 1 };
      return { release: () => { calls.push("release"); } };
    },
    fetchAll: async () => {
      return [{
        uid: 12,
        internalDate: new Date("2026-09-03T10:00:00Z"),
        envelope: {
          from: [{ name: "Person", address: "person@example.test" }],
          to: [{ address: "customer@example.test" }],
          subject: "Hello"
        }
      }];
    },
    fetchOne: async () => {
      return {
        headers: Buffer.from("From: Person <person@example.test>\r\nSubject: Hello\r\n\r\n"),
        envelope: {
          from: [{ name: "Person", address: "person@example.test" }],
          to: [{ address: "customer@example.test" }],
          subject: "Hello",
          messageId: "<message@example.test>"
        }
      };
    }
  };
  const service = new SieveImapSpamClient(() => { return client; });
  const inbox = await service.listInbox();
  const details = await service.getInboxDetails("9:12");

  suite.assertEquals(inbox.folderName, "INBOX");
  suite.assertEquals(inbox.mailboxes.join(","), "INBOX,Archive");
  suite.assertEquals(inbox.messages[0].id, "9:12");
  suite.assertEquals(details.senderAddress, "person@example.test");
  suite.assertTrue(details.headers.includes("Subject: Hello"));
  suite.assertEquals(calls.filter((item) => { return item === "logout"; }).length, 2);
});

suite.add("Inbox selection state enables only one rule action", function () {
  const createButton = { disabled: true };
  const applyButton = { disabled: true };
  const spamButton = { disabled: true };
  const controls = [
    { value: "message-1", checked: false },
    { value: "message-2", checked: false }
  ];
  const inbox = Object.create(SieveInboxUI.prototype);
  inbox.inboxConfigured = true;
  inbox.root = {
    querySelector(selector) {
      if (selector === ".sieve-inbox-create-rule")
        return createButton;
      if (selector === ".sieve-inbox-apply-selected")
        return applyButton;
      if (selector === ".sieve-inbox-mark-spam")
        return spamButton;
      return null;
    },
    querySelectorAll(selector) {
      return selector === ".sieve-inbox-select" ? controls : [];
    }
  };

  inbox.selectMessage("message-2");
  suite.assertEquals(inbox.selectedId, "message-2");
  suite.assertFalse(createButton.disabled);
  suite.assertFalse(applyButton.disabled);
  suite.assertFalse(spamButton.disabled);
  suite.assertFalse(controls[0].checked);
  suite.assertTrue(controls[1].checked);
});

suite.add("Inbox dates are formatted and sorted chronologically", function () {
  const localDate = new Date(2026, 8, 4, 7, 8, 9);
  suite.assertEquals(formatInboxDate(localDate), "2026.09.04, 07:08:09");
  suite.assertEquals(formatInboxDate("invalid"), "");

  const messages = [
    { id: "older", date: "2025-12-31T23:59:59Z" },
    { id: "invalid", date: "not-a-date" },
    { id: "newer-a", date: "2026-01-02T01:00:00Z" },
    { id: "newer-b", date: "2026-01-02T01:00:00Z" },
    { id: "missing", date: "" }
  ];
  const sorted = sortInboxMessagesByDate(messages);

  suite.assertEquals(
    sorted.map((message) => { return message.id; }).join(","),
    "newer-a,newer-b,older,invalid,missing");
  suite.assertEquals(messages[0].id, "older");
});

suite.add("Inbox row context menu selects the right-clicked message", function () {
  const createButton = { disabled: true };
  const applyButton = { disabled: true };
  const spamButton = { disabled: true };
  const contextApply = { disabled: true };
  const classes = new Set();
  const menu = {
    style: {},
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); }
    },
    querySelector(selector) {
      return selector === ".sieve-inbox-context-apply" ? contextApply : null;
    },
    getBoundingClientRect() { return { width: 180, height: 80 }; }
  };
  const inbox = Object.create(SieveInboxUI.prototype);
  inbox.inboxConfigured = true;
  inbox.root = {
    ownerDocument: {
      defaultView: { innerWidth: 1024, innerHeight: 768 }
    },
    querySelector(selector) {
      if (selector === ".sieve-inbox-create-rule")
        return createButton;
      if (selector === ".sieve-inbox-apply-selected")
        return applyButton;
      if (selector === ".sieve-inbox-mark-spam")
        return spamButton;
      if (selector === ".sieve-inbox-context-menu")
        return menu;
      return null;
    },
    querySelectorAll() { return []; }
  };
  let prevented = false;
  inbox.showContextMenu({
    clientX: 10,
    clientY: 20,
    preventDefault() { prevented = true; }
  }, "right-clicked");

  suite.assertTrue(prevented);
  suite.assertEquals(inbox.selectedId, "right-clicked");
  suite.assertTrue(classes.has("show"));
  suite.assertFalse(contextApply.disabled);
  suite.assertEquals(menu.style.left, "10px");
  suite.assertEquals(menu.style.top, "20px");
});

suite.add("Home accounts are sorted by their visible names", function () {
  const accounts = [
    { id: "z", displayName: "Server 10" },
    { id: "b", displayName: "älpha" },
    { id: "a", displayName: "Alpha" },
    { id: "c", displayName: "Server 2" }
  ];
  const sorted = sortAccountsByDisplayName(accounts, "de");

  suite.assertEquals(
    sorted.map((account) => { return account.id; }).join(","), "a,b,c,z");
  suite.assertEquals(accounts[0].id, "z");
});

suite.add("Run Sieve applies the marked Inbox message", async function () {
  const button = { disabled: false };
  const calls = [];
  const inbox = Object.create(SieveInboxUI.prototype);
  inbox.inboxConfigured = true;
  inbox.selectedId = "older";
  inbox.messages = [
    { id: "older", date: "2026-09-03T12:00:00Z", subject: "Older" },
    { id: "newest", date: "2026-09-04T12:00:00Z", subject: "Newest" }
  ];
  inbox.root = {
    querySelector(selector) {
      return selector === ".sieve-inbox-apply-selected" ? button : null;
    }
  };
  inbox.account = {
    async send(action, payload) {
      calls.push({ action, payload });
      return { script: "active", filtered: 1, warnings: 0, errors: 0 };
    }
  };
  inbox.string = (key, fallback) => { return fallback; };
  inbox.confirmApply = () => { return true; };
  inbox.setStatus = () => {};
  inbox.render = async () => {};

  await inbox.applySelected();
  suite.assertEquals(calls.length, 1);
  suite.assertEquals(calls[0].action, "account-inbox-apply-selected");
  suite.assertEquals(calls[0].payload.messageId, "older");
  suite.assertFalse(button.disabled);
});

suite.add("Inbox Spam marks and moves the selected message", async function () {
  const button = { disabled: false };
  const calls = [];
  const statuses = [];
  const inbox = Object.create(SieveInboxUI.prototype);
  inbox.inboxConfigured = true;
  inbox.selectedId = "selected";
  inbox.messages = [{
    id: "selected",
    date: "2026-09-04T12:00:00Z",
    subject: "Spam offer"
  }];
  inbox.root = {
    querySelector(selector) {
      return selector === ".sieve-inbox-mark-spam" ? button : null;
    }
  };
  inbox.account = {
    async send(action, payload) {
      calls.push({ action, payload });
      return { processed: 1, folder: "Junk", spamTrainingQueued: 1 };
    }
  };
  inbox.string = (key, fallback) => { return fallback; };
  inbox.confirmApply = () => { return true; };
  inbox.setStatus = (text) => { statuses.push(text); };
  inbox.render = async () => {};

  await inbox.markSelectedAsSpam();
  suite.assertEquals(calls[0].action, "account-inbox-mark-spam");
  suite.assertEquals(calls[0].payload.messageId, "selected");
  suite.assertTrue(statuses.at(-1).includes("moved to Junk"));
  suite.assertFalse(button.disabled);
});

suite.add("Direct IMAP Spam action marks, trains and moves one Inbox UID", async function () {
  const operations = [];
  const client = {
    usable: true,
    mailbox: null,
    async connect() {},
    async logout() {},
    async list() {
      return [
        { path: "INBOX", specialUse: "\\Inbox" },
        { path: "Junk", specialUse: "\\Junk" }
      ];
    },
    async getMailboxLock(folder) {
      operations.push(["lock", folder]);
      this.mailbox = { uidValidity: 42n };
      return { release() { operations.push(["release"]); } };
    },
    async search() { return [123]; },
    async messageFlagsRemove(uid, flags, options) {
      operations.push(["remove", uid, flags.join(","), options.uid]);
    },
    async messageFlagsAdd(uid, flags, options) {
      operations.push(["add", uid, flags.join(","), options.uid]);
    },
    async messageMove(uid, folder, options) {
      operations.push(["move", uid, folder, options.uid]);
    }
  };
  const spam = new SieveImapSpamClient(() => { return client; });
  const result = await spam.markInboxSpam("42:123");

  suite.assertEquals(result.folder, "Junk");
  suite.assertTrue(operations.some((item) => {
    return item[0] === "add" && item[2].includes("rspamdspam");
  }));
  suite.assertTrue(operations.some((item) => {
    return item[0] === "move" && item[1] === 123 && item[2] === "Junk";
  }));
});

suite.add("Inbox rule editor formats similar matches from multiple scripts", function () {
  const matches = findSpamRuleMatches([{
    name: "active-filter",
    active: true,
    content: [
      "if address :is \"from\" \"person@example.test\" {",
      "  fileinto \"Customers\";",
      "}"
    ].join("\n")
  }, {
    name: "subject-filter",
    active: false,
    content: "if header :contains \"Subject\" \"Expected subject\" { keep; }"
  }], {
    senderAddress: "person@example.test",
    senderDomain: "example.test",
    recipientAddresses: ["customer@example.test"],
    subject: "Expected subject"
  });
  const summary = formatInboxRuleMatches(matches, {
    sender: "Sender address",
    domain: "Sender domain",
    recipient: "Recipient",
    subject: "Subject",
    active: "active",
    line: "Line"
  });

  suite.assertTrue(summary.includes("# active-filter (active)"));
  suite.assertTrue(summary.includes("Sender address: person@example.test"));
  suite.assertTrue(summary.includes("Sender domain: example.test"));
  suite.assertTrue(summary.includes("Line 1:\n1: if address :is"));
  suite.assertTrue(summary.includes("2:   fileinto \"Customers\";"));
  suite.assertTrue(summary.includes("# subject-filter"));
  suite.assertTrue(summary.includes("Subject: Expected subject"));
});

suite.add("Inbox rule editor connects Sieve before loading the script selector", async function () {
  const calls = [];
  let connected = false;
  const inbox = Object.create(SieveInboxUI.prototype);
  inbox.account = {
    async isConnected() {
      calls.push("is-connected");
      return connected;
    },
    async send(action) {
      calls.push(action);
      if (action === "account-connect")
        connected = true;
    },
    setConnectionActions(connectedState, connectingState) {
      calls.push(`connection-actions:${connectedState}:${connectingState}`);
    }
  };
  inbox.string = (key, fallback) => { return fallback; };
  inbox.setStatus = (status) => { calls.push(status); };

  suite.assertTrue(await inbox.ensureSieveConnected());
  suite.assertEquals(calls.join(","),
    "is-connected,Connecting the Sieve client…,account-connect,is-connected,connection-actions:true:false");

  calls.length = 0;
  suite.assertFalse(await inbox.ensureSieveConnected());
  suite.assertEquals(calls.join(","), "is-connected");
});

suite.add("Inbox rule editor bounds stalled server operations", async function () {
  const inbox = Object.create(SieveInboxUI.prototype);
  let error = "";

  try {
    await inbox.waitForRuleEditorOperation(
      new Promise(() => {}), "Expected timeout", 1);
  } catch (ex) {
    error = ex.message;
  }

  suite.assertEquals(error, "Expected timeout");
});

suite.add("Inbox rule editor fills headers, similar rules and both editor views", async function () {
  const createControl = () => {
    return {
      children: [],
      className: "",
      disabled: false,
      textContent: "",
      value: "",
      append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; }
    };
  };
  const controls = {
    ".sieve-inbox-rule-headers": createControl(),
    ".sieve-inbox-rule-similar": createControl(),
    ".sieve-inbox-rule-similar-status": createControl(),
    ".sieve-inbox-rule-source": createControl(),
    ".sieve-inbox-rule-script": createControl(),
    ".sieve-inbox-rule-connection": createControl(),
    ".sieve-inbox-rule-lint": createControl(),
    ".sieve-inbox-rule-save": createControl(),
    ".sieve-inbox-rule-mailboxes": createControl(),
    ".sieve-inbox-rule-mailbox": createControl()
  };
  const modal = {
    querySelector(selector) { return controls[selector]; }
  };
  const calls = [];
  const inbox = Object.create(SieveInboxUI.prototype);
  inbox.selectedId = "9:12";
  inbox.mailboxes = ["INBOX", "Customers"];
  inbox.string = (_key, fallback) => { return fallback; };
  inbox.root = {
    querySelector(selector) {
      return selector === ".sieve-inbox-rule-modal" ? modal : controls[selector];
    }
  };
  inbox.account = {
    async send(action, payload) {
      calls.push(`${action}:${payload?.messageId || ""}`);
      if (action === "account-inbox-details") {
        return {
          headers: "From: Person <person@example.test>\r\nSubject: Expected subject",
          senderAddress: "person@example.test",
          senderDomain: "example.test",
          recipientAddresses: ["customer@example.test"],
          subject: "Expected subject"
        };
      }
      if (action === "account-inbox-rule-scripts") {
        return {
          connected: true,
          scripts: [{
            name: "active-filter",
            active: true,
            content: [
              'if address :is "from" "person@example.test" {',
              '  fileinto "Customers";',
              "}"
            ].join("\n")
          }]
        };
      }
      if (action === "account-capabilities")
        return { extensions: { fileinto: true, mailbox: true } };
      throw new Error(`Unexpected action ${action}`);
    }
  };
  inbox.ensureSieveConnected = async () => { calls.push("ensure-connected:"); };
  inbox.setEditorStatus = (text, style) => { calls.push(`status:${style || ""}:${text}`); };
  inbox.hideEditorStatus = () => { calls.push("hide-status:"); };
  inbox.updateMailboxStatus = () => { calls.push("mailbox-status:"); };
  inbox.renderRows = () => { calls.push("render-rows:"); };
  inbox.setRuleGraphicalSource = async (source) => {
    inbox.ruleGraphicalSourceLoaded = true;
    calls.push(`graphical:${source}`);
  };
  inbox.waitForRuleEditorOperation = async (operation) => { return await operation; };

  const oldBootstrap = globalThis.bootstrap;
  const oldDocument = globalThis.document;
  let shown = false;
  globalThis.bootstrap = {
    Modal: {
      getOrCreateInstance() {
        return { show() { shown = true; } };
      }
    }
  };
  globalThis.document = { createElement: () => { return createControl(); } };

  let sourceFallbackShown = false;
  try {
    await inbox.openRuleEditor();
    inbox.setRuleGraphicalSource = async () => {
      throw new Error("graphical probe failure");
    };
    inbox.showRuleSourceTab = () => { sourceFallbackShown = true; };
    await inbox.openRuleEditor();
  } finally {
    globalThis.bootstrap = oldBootstrap;
    globalThis.document = oldDocument;
  }

  suite.assertTrue(shown);
  suite.assertTrue(controls[".sieve-inbox-rule-headers"].value.includes("Subject: Expected subject"));
  suite.assertTrue(controls[".sieve-inbox-rule-source"].value.includes('fileinto :create "INBOX";'));
  suite.assertTrue(controls[".sieve-inbox-rule-similar"].value.includes("# active-filter (active)"));
  suite.assertEquals(controls[".sieve-inbox-rule-script"].value, "active-filter");
  suite.assertFalse(controls[".sieve-inbox-rule-lint"].disabled);
  suite.assertFalse(controls[".sieve-inbox-rule-save"].disabled);
  suite.assertTrue(sourceFallbackShown);
  suite.assertTrue(calls.some((item) => {
    return item.includes("status:warning:The graphical Sieve editor could not be loaded");
  }));
  suite.assertTrue(calls.indexOf("account-inbox-details:9:12")
    < calls.indexOf("ensure-connected:"));
  suite.assertTrue(calls.findIndex((item) => { return item.startsWith("graphical:"); })
    < calls.indexOf("ensure-connected:"));
  suite.assertTrue(calls.some((item) => { return item.startsWith("graphical:# Created from Inbox:"); }));
});

suite.add("Inbox mailbox input preserves freely edited rules", async function () {
  const source = { value: "custom rule" };
  const graphicalTab = {
    classList: { contains() { return false; } }
  };
  const modal = {
    querySelector(selector) {
      if (selector === ".sieve-inbox-rule-graphical-tab")
        return graphicalTab;
      return source;
    }
  };
  const inbox = Object.create(SieveInboxUI.prototype);
  inbox.lastTemplate = "generated rule";
  inbox.root = {
    querySelector(selector) {
      return selector === ".sieve-inbox-rule-modal" ? modal : source;
    }
  };
  let updates = 0;
  inbox.createTemplate = () => { updates++; };

  await inbox.updateTemplateMailbox();
  suite.assertEquals(updates, 0);

  source.value = "generated rule";
  await inbox.updateTemplateMailbox();
  suite.assertEquals(updates, 1);

  updates = 0;
  source.value = "generated rule\r\n";
  await inbox.updateTemplateMailbox();
  suite.assertEquals(updates, 1);
});

suite.add("Inbox rule source helpers use the graphical editor", async function () {
  const textarea = { value: "textarea source" };
  const graphicalTab = {
    classList: { contains() { return true; } }
  };
  const modal = {
    querySelector(selector) {
      if (selector === ".sieve-inbox-rule-graphical-tab")
        return graphicalTab;
      return textarea;
    }
  };
  const editor = {
    value: "editor source",
    getSieveScript() { return this.value; },
    setSieveScript(value, capabilities) {
      this.value = value;
      this.capabilities = capabilities;
    }
  };
  const inbox = Object.create(SieveInboxUI.prototype);
  inbox.ruleCapabilities = { extensions: { fileinto: true } };
  inbox.ruleGraphicalEditorWindow = editor;
  inbox.ruleGraphicalEditorReady = Promise.resolve(editor);
  inbox.ruleGraphicalSourceLoaded = true;
  inbox.syncRuleEditorTheme = () => {};
  inbox.root = {
    querySelector(selector) {
      return selector === ".sieve-inbox-rule-modal" ? modal : textarea;
    }
  };

  suite.assertEquals(inbox.getRuleSource(), "editor source");
  await inbox.setRuleSource("updated editor source");
  suite.assertEquals(editor.value, "updated editor source");
  suite.assertEquals(editor.capabilities, '{"fileinto":true}');
  suite.assertEquals(textarea.value, "updated editor source");

  inbox.ruleCapabilities = { extensions: {} };
  await inbox.setRuleSource([
    "if true {",
    '\tfileinto :create "Customers";',
    "}"
  ].join("\n"));
  suite.assertTrue(JSON.parse(editor.capabilities).fileinto);
  suite.assertTrue(JSON.parse(editor.capabilities).mailbox);

  inbox.ruleGraphicalEditorWindow = null;
  inbox.ruleGraphicalEditorReady = null;
  inbox.ruleGraphicalSourceLoaded = false;
  await inbox.setRuleSource("updated fallback source");
  suite.assertEquals(inbox.getRuleSource(), "updated fallback source");
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
