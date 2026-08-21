/* global net */

const suite = net.tschmid.yautt.test;

if (!suite)
  throw new Error("Could not initialize test suite");

import {
  convertFilter,
  createCombinedScript,
  createFilterId,
  findImplementations,
  folderUriToMailbox,
  upsertFilterInScript
} from "./../SieveThunderbirdFilterConverter.mjs";

const INCOMING_FILTER = 1;
const ATTR_SUBJECT = 0;
const ATTR_SENDER = 1;
const ATTR_BODY = 2;
const ATTR_SIZE = 14;
const OP_CONTAINS = 0;
const OP_IS_IN_ADDRESS_BOOK = 16;
const OP_GREATER_THAN = 13;
const ACTION_MOVE = 1;
const ACTION_DELETE = 3;
const ACTION_MARK_READ = 4;
const ACTION_STOP = 11;
const ACTION_COPY = 16;
const SIZE_KILOBYTES = 100;
const FILTER_LIST_INDEX = 3;

/**
 * Creates a representative fully translatable incoming filter.
 *
 * @returns {object}
 *   serialized Thunderbird filter data.
 */
function createSupportedFilter() {
  return {
    index: FILTER_LIST_INDEX,
    deleteToken: "unchanged-filter-token",
    name: "Invoices",
    enabled: true,
    filterType: INCOMING_FILTER,
    unparseable: false,
    terms: [
      { attrib: ATTR_SENDER, op: OP_CONTAINS, booleanAnd: true, value: { str: "@company.test" } },
      { attrib: ATTR_SUBJECT, op: OP_CONTAINS, booleanAnd: true, value: { str: "Invoice" } }
    ],
    actions: [
      { type: ACTION_MOVE, targetFolderUri: "imap://user@example.test/INBOX/Invoices" },
      { type: ACTION_STOP }
    ]
  };
}

suite.add("Thunderbird filter converts conditions and actions", function () {
  const result = convertFilter(createSupportedFilter());

  suite.assertTrue(result.fullySupported);
  suite.assertTrue(result.sieve.includes(
    'allof(header :contains "from" "@company.test", header :contains "subject" "Invoice")'));
  suite.assertTrue(result.sieve.includes('fileinto "INBOX/Invoices";'));
  suite.assertTrue(result.sieve.includes("stop;"));
  suite.assertEquals(result.requirements.toString(), "fileinto");
  suite.assertEquals(result.sourceIndex, FILTER_LIST_INDEX);
  suite.assertEquals(result.deleteToken, "unchanged-filter-token");
});

suite.add("Unsupported Thunderbird condition is safely guarded", function () {
  const result = convertFilter({
    name: "Address book",
    enabled: true,
    filterType: INCOMING_FILTER,
    terms: [{
      attrib: ATTR_SENDER,
      op: OP_IS_IN_ADDRESS_BOOK,
      booleanAnd: true,
      value: { str: "moz-abmdbdirectory://abook.sqlite" }
    }],
    actions: [{ type: ACTION_DELETE }]
  });

  suite.assertFalse(result.fullySupported);
  suite.assertTrue(result.sieve.includes("if allof(false, false)"));
  suite.assertTrue(result.sieve.includes("REVIEW REQUIRED"));
});

suite.add("Disabled Thunderbird filter remains guarded", function () {
  const result = convertFilter({
    name: "Disabled",
    enabled: false,
    filterType: INCOMING_FILTER,
    terms: [{
      attrib: ATTR_SIZE,
      op: OP_GREATER_THAN,
      booleanAnd: true,
      value: { size: SIZE_KILOBYTES }
    }],
    actions: [{ type: ACTION_COPY, targetFolderUri: "imap://user@example.test/Archive" }]
  });

  suite.assertFalse(result.fullySupported);
  suite.assertTrue(result.sieve.includes("size :over 100K"));
  suite.assertTrue(result.sieve.includes('fileinto :copy "Archive";'));
});

suite.add("Combined script consolidates Sieve requirements", function () {
  const supported = convertFilter(createSupportedFilter());
  const copied = convertFilter({
    name: "Copy",
    enabled: true,
    filterType: INCOMING_FILTER,
    terms: [],
    actions: [{ type: ACTION_COPY, targetFolderUri: "imap://user@example.test/Archive" }]
  });
  const script = createCombinedScript([supported, copied]);

  suite.assertTrue(script.includes('require ["copy", "fileinto"];'));
  suite.expectValidScript(script.replace(/\n/g, "\r\n"), ["copy", "fileinto"]);
});

suite.add("Generated body and flag extensions form a valid Sieve script", function () {
  const converted = convertFilter({
    name: "Urgent body",
    enabled: true,
    filterType: INCOMING_FILTER,
    terms: [{
      attrib: ATTR_BODY,
      op: OP_CONTAINS,
      booleanAnd: true,
      value: { str: "urgent" }
    }],
    actions: [{ type: ACTION_MARK_READ }]
  });
  const script = createCombinedScript([converted]).replace(/\n/g, "\r\n");

  suite.expectValidScript(script, ["body", "imap4flags"]);
});

suite.add("Generated marker identifies an implemented server script", function () {
  const filter = createSupportedFilter();
  const result = convertFilter(filter);
  const matches = findImplementations(result, [
    { name: "main", content: `# thunderbird-filter-id: ${result.id}` },
    { name: "other", content: "# unrelated" }
  ]);

  suite.assertEquals(createFilterId(filter), result.id);
  suite.assertEquals(matches.toString(), "main");
});

suite.add("Direct save appends a managed block and missing requirements", function () {
  const copied = convertFilter({
    name: "Copy",
    enabled: true,
    filterType: INCOMING_FILTER,
    terms: [],
    actions: [{ type: ACTION_COPY, targetFolderUri: "imap://user@example.test/Archive" }]
  });
  const script = upsertFilterInScript(
    'require "fileinto";\n\nif true {\n  keep;\n}\n', copied);

  suite.assertTrue(script.startsWith('require ["copy"];\n'));
  suite.assertTrue(script.includes(`# BEGIN thunderbird-sieve-filter ${copied.id}`));
  suite.expectValidScript(script.replace(/\n/g, "\r\n"), ["copy", "fileinto"]);
});

suite.add("Direct save replaces one existing managed block", function () {
  const converted = convertFilter(createSupportedFilter());
  const original = upsertFilterInScript("", converted);
  const updated = upsertFilterInScript(original, {
    ...converted,
    sieve: converted.sieve.replace("stop;", "discard;")
  });
  const marker = `# BEGIN thunderbird-sieve-filter ${converted.id}`;

  suite.assertEquals(updated.indexOf(marker), updated.lastIndexOf(marker));
  suite.assertTrue(updated.includes("discard;"));
  suite.assertFalse(updated.includes("stop;"));
  suite.expectValidScript(updated.replace(/\n/g, "\r\n"), ["fileinto"]);
});

suite.add("Direct save refuses an older unbounded generated block", function () {
  const converted = convertFilter(createSupportedFilter());
  suite.assertThrows(() => {
    upsertFilterInScript(`# thunderbird-filter-id: ${converted.id}\n`, converted);
  }, "This script contains an older unbounded Thunderbird block. Replace it manually once before direct updates.");
});

suite.add("Only IMAP folder URIs become Sieve mailbox names", function () {
  suite.assertEquals(
    folderUriToMailbox("imap://user@example.test/INBOX/Test%20Folder"),
    "INBOX/Test Folder");
  suite.assertEquals(folderUriToMailbox("mailbox:///Local/Folder"), "");
});
