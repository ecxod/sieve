/* global net */

const suite = net.tschmid.yautt.test;

if (!suite)
  throw new Error("Could not initialize test suite");

import { formatSieveScript } from "./../SieveFormatter.mjs";
import { SieveTextEditorUI } from "./../SieveTextEditor.mjs";
import { SieveEditorSettings } from "./../../../settings/logic/SieveEditorSettings.mjs";

suite.add("Sieve formatter adds structural line breaks and tabs", function () {
  const script = 'require["fileinto","copy"];if true{fileinto :copy "Archive";stop;}else{keep;}';
  const expected = [
    'require [',
    '\t"fileinto",',
    '\t"copy"',
    '];',
    'if true {',
    '\tfileinto :copy "Archive";',
    '\tstop;',
    '}',
    'else {',
    '\tkeep;',
    '}',
    ''
  ].join("\n");

  suite.assertEquals(formatSieveScript(script), expected);
});

suite.add("Sieve formatter indents nested lists and test arguments", function () {
  const script = 'if allof(header :contains ["subject","from"] ["urgent","boss"],not exists ["x-test"]){keep;}';
  const expected = [
    'if allof (',
    '\theader :contains [',
    '\t\t"subject",',
    '\t\t"from"',
    '\t] [',
    '\t\t"urgent",',
    '\t\t"boss"',
    '\t],',
    '\tnot exists [',
    '\t\t"x-test"',
    '\t]',
    ') {',
    '\tkeep;',
    '}',
    ''
  ].join("\n");

  suite.assertEquals(formatSieveScript(script), expected);
});

suite.add("Sieve formatter applies compact, spaces and brace preferences", function () {
  const script = 'require["fileinto","copy"];if allof(true,false){fileinto "A";}';
  const expected = [
    'require ["fileinto", "copy"];',
    'if allof (true, false)',
    '{',
    '   fileinto "A";',
    '}',
    ''
  ].join("\n");

  suite.assertEquals(formatSieveScript(script, {
    indentWithTabs: false,
    indentWidth: 3,
    multilineLists: false,
    multilineTests: false,
    braceOnNewLine: true
  }), expected);
});

suite.add("Compact formatting keeps existing comma line breaks by default", function () {
  const formatted = formatSieveScript([
    'require ["fileinto",',
    '"copy"];',
    'if allof (true,\r',
    'false) { keep; }'
  ].join("\n"), {
    multilineLists: false,
    multilineTests: false
  });

  suite.assertEquals(formatted, [
    'require ["fileinto",',
    '"copy"];',
    'if allof (true,',
    'false) {',
    '\tkeep;',
    '}',
    ''
  ].join("\n"));
});

suite.add("Compact option ignores existing comma line breaks", function () {
  const script = 'require ["fileinto",\n"copy"];if allof (true,\r\nfalse){keep;}';
  const formatted = formatSieveScript(script, {
    multilineLists: false,
    multilineTests: false,
    ignoreCompactLineBreaks: true
  });

  suite.assertEquals(formatted, [
    'require ["fileinto", "copy"];',
    'if allof (true, false) {',
    '\tkeep;',
    '}',
    ''
  ].join("\n"));
});

suite.add("Sieve formatter combines require commands into one list", function () {
  const script = [
    '# capabilities',
    'require "fileinto";',
    '# retained comment',
    'require ["copy", "vacation"];',
    'keep;'
  ].join("\n");
  const expected = [
    '# capabilities',
    'require [',
    '\t"fileinto",',
    '\t"copy",',
    '\t"vacation"',
    '];',
    '# retained comment',
    'keep;',
    ''
  ].join("\n");

  const formatted = formatSieveScript(script, {
    combineRequires: true
  });

  suite.assertEquals(formatted, expected);
  suite.parseScript(formatted, ["fileinto", "copy", "vacation"]);
});

suite.add("Sieve formatter keeps require commands separate by default", function () {
  const script = 'require "fileinto";require "copy";';
  const expected = [
    'require "fileinto";',
    'require "copy";',
    ''
  ].join("\n");

  suite.assertEquals(formatSieveScript(script), expected);
});

suite.add("Sieve formatter adds one blank line after the require section", function () {
  const script = [
    'require "fileinto";',
    '# capability for the next declaration',
    'require "copy";',
    'keep;'
  ].join("\n");
  const expected = [
    'require "fileinto";',
    '# capability for the next declaration',
    'require "copy";',
    '',
    'keep;',
    ''
  ].join("\n");

  const formatted = formatSieveScript(script, {
    blankLineAfterRequires: true
  });

  suite.assertEquals(formatted, expected);
  suite.parseScript(formatted, ["fileinto", "copy"]);
});

suite.add("Sieve formatter separates a combined require section", function () {
  const formatted = formatSieveScript(
    'require "fileinto";require "copy";keep;', {
      combineRequires: true,
      blankLineAfterRequires: true
    });
  const expected = [
    'require [',
    '\t"fileinto",',
    '\t"copy"',
    '];',
    '',
    'keep;',
    ''
  ].join("\n");

  suite.assertEquals(formatted, expected);
  suite.parseScript(formatted, ["fileinto", "copy"]);
});

suite.add("Sieve formatter adds blank lines after complete if chains", function () {
  const script = [
    'if true{keep;}# between branches',
    'elsif false{discard;}else{stop;}',
    'if true{if false{stop;}}',
    'keep;'
  ].join("\n");
  const expected = [
    'if true {',
    '\tkeep;',
    '}',
    '# between branches',
    'elsif false {',
    '\tdiscard;',
    '}',
    'else {',
    '\tstop;',
    '}',
    '',
    'if true {',
    '\tif false {',
    '\t\tstop;',
    '\t}',
    '}',
    '',
    'keep;',
    ''
  ].join("\n");

  const formatted = formatSieveScript(script, {
    blankLineAfterIf: true
  });

  suite.assertEquals(formatted, expected);
  suite.parseScript(formatted);
});

suite.add("Sieve formatter sorts independent if chains by fileinto folder", function () {
  const script = [
    'require "fileinto";',
    '# Zulu rule',
    'if header :is "subject" "z" { fileinto "Zulu"; }',
    '# Archive rule',
    'if header :is "subject" "a" { fileinto "Archive"; }',
    '# Inbox rule',
    'if header :is "subject" "i" { fileinto "Inbox"; }',
    'keep;'
  ].join("\n");
  const expected = [
    'require "fileinto";',
    '# Archive rule',
    'if header :is "subject" "a" {',
    '\tfileinto "Archive";',
    '}',
    '# Inbox rule',
    'if header :is "subject" "i" {',
    '\tfileinto "Inbox";',
    '}',
    '# Zulu rule',
    'if header :is "subject" "z" {',
    '\tfileinto "Zulu";',
    '}',
    'keep;',
    ''
  ].join("\n");

  const formatted = formatSieveScript(script, {
    sortIfByFileinto: true
  });

  suite.assertEquals(formatted, expected);
  suite.parseScript(formatted, ["fileinto"]);
});

suite.add("Sieve formatter moves complete if chains while sorting", function () {
  const script = [
    '# Zulu chain',
    'if false { fileinto "Zulu"; } elsif true { fileinto "Zulu"; }',
    '# Archive chain',
    'if true { fileinto "Archive"; } else { fileinto "Archive"; }'
  ].join("\n");
  const expected = [
    '# Archive chain',
    'if true {',
    '\tfileinto "Archive";',
    '}',
    'else {',
    '\tfileinto "Archive";',
    '}',
    '# Zulu chain',
    'if false {',
    '\tfileinto "Zulu";',
    '}',
    'elsif true {',
    '\tfileinto "Zulu";',
    '}',
    ''
  ].join("\n");

  suite.assertEquals(formatSieveScript(script, {
    sortIfByFileinto: true
  }), expected);
});

suite.add("Sieve formatter uses the mailbox after fileinto tag arguments", function () {
  const formatted = formatSieveScript([
    'if true { fileinto :flags ["\\\\Seen"] "Zulu"; }',
    'if true { fileinto :flags ["\\\\Flagged"] "Archive"; }'
  ].join("\n"), {
    sortIfByFileinto: true
  });

  suite.assertTrue(formatted.indexOf('fileinto :flags [')
    < formatted.indexOf('fileinto :flags [', formatted.indexOf('fileinto :flags [') + 1));
  suite.assertTrue(formatted.indexOf('"Archive";')
    < formatted.indexOf('"Zulu";'));
});

suite.add("Sieve formatter keeps ambiguous and nested if chains in place", function () {
  const script = [
    'if true { fileinto "Zulu"; }',
    'if true { fileinto "Beta"; fileinto "Gamma"; }',
    'if true { fileinto "Archive"; }',
    'if true {',
    'if true { fileinto "Nested-Zulu"; }',
    'if true { fileinto "Nested-Archive"; }',
    '}'
  ].join("\n");
  const formatted = formatSieveScript(script, {
    sortIfByFileinto: true
  });

  suite.assertTrue(formatted.indexOf('fileinto "Zulu";')
    < formatted.indexOf('fileinto "Beta";'));
  suite.assertTrue(formatted.indexOf('fileinto "Beta";')
    < formatted.indexOf('fileinto "Archive";'));
  suite.assertTrue(formatted.indexOf('fileinto "Nested-Zulu";')
    < formatted.indexOf('fileinto "Nested-Archive";'));
});

suite.add("Sieve formatter keeps if-chain order by default", function () {
  const formatted = formatSieveScript([
    'if true { fileinto "Zulu"; }',
    'if true { fileinto "Archive"; }'
  ].join("\n"));

  suite.assertTrue(formatted.indexOf('fileinto "Zulu";')
    < formatted.indexOf('fileinto "Archive";'));
});

suite.add("Sieve formatter combines safe sibling if blocks with anyof", function () {
  const script = [
    '# Sender rule',
    'if address :is "from" "a@example.org" { fileinto "Customers"; stop; }',
    '# Subject rule',
    'if header :contains "subject" "Order" { fileinto "Customers"; stop; }'
  ].join("\n");
  const expected = [
    'if anyof (',
    '\t# Sender rule',
    '\taddress :is "from" "a@example.org",',
    '\t# Subject rule',
    '\theader :contains "subject" "Order"',
    ') {',
    '\tfileinto "Customers";',
    '\tstop;',
    '}',
    ''
  ].join("\n");
  const formatted = formatSieveScript(script, {
    combineIfWithAnyof: true
  });

  suite.assertEquals(formatted, expected);
  suite.parseScript(formatted, ["fileinto"]);
});

suite.add("Sieve formatter combines sibling if blocks at nested levels", function () {
  const script = [
    'if envelope :domain "to" "example.org" {',
    'if header :is "subject" "Invoice" { fileinto "Accounting"; stop; }',
    'if header :is "subject" "Reminder" { fileinto "Accounting"; stop; }',
    '}'
  ].join("\n");
  const expected = [
    'if envelope :domain "to" "example.org" {',
    '\tif anyof (',
    '\t\theader :is "subject" "Invoice",',
    '\t\theader :is "subject" "Reminder"',
    '\t) {',
    '\t\tfileinto "Accounting";',
    '\t\tstop;',
    '\t}',
    '}',
    ''
  ].join("\n");
  const formatted = formatSieveScript(script, {
    combineIfWithAnyof: true
  });

  suite.assertEquals(formatted, expected);
  suite.parseScript(formatted, ["fileinto", "envelope"]);
});

suite.add("Sieve formatter keeps unsafe or separated if blocks independent", function () {
  const script = [
    'if true { fileinto "First"; stop; }',
    'keep;',
    'if false { fileinto "First"; stop; }',
    'if true { fileinto "Second"; }',
    'if false { fileinto "Second"; }',
    'if true { fileinto "Third"; stop; }',
    'elsif false { fileinto "Third"; stop; }',
    'if false { fileinto "Third"; stop; }'
  ].join("\n");
  const formatted = formatSieveScript(script, {
    combineIfWithAnyof: true
  });

  suite.assertFalse(formatted.includes("anyof"));
  suite.parseScript(formatted, ["fileinto"]);
});

suite.add("Sieve formatter preserves comments from combined action bodies", function () {
  const script = [
    'if true { # First action comment',
    'FILEINTO "Archive"; stop; }',
    'if false { /* Second action comment */',
    'fileinto "Archive"; STOP; }'
  ].join("\n");
  const formatted = formatSieveScript(script, {
    combineIfWithAnyof: true
  });

  suite.assertTrue(formatted.includes("if anyof ("));
  suite.assertTrue(formatted.includes("# First action comment"));
  suite.assertTrue(formatted.includes("/* Second action comment */"));
  suite.parseScript(formatted, ["fileinto"]);
});

suite.add("Sieve formatter combines commented conditions in compact mode", function () {
  const formatted = formatSieveScript([
    '# First condition',
    'if true { fileinto "Archive"; stop; }',
    '# Second condition',
    'if false { fileinto "Archive"; stop; }'
  ].join("\n"), {
    combineIfWithAnyof: true,
    multilineTests: false
  });

  suite.assertTrue(formatted.includes("# First condition"));
  suite.assertTrue(formatted.includes("# Second condition"));
  suite.parseScript(formatted, ["fileinto"]);
});

suite.add("Sieve formatter combines after fileinto sorting", function () {
  const script = [
    'if header :is "subject" "z1" { fileinto "Zulu"; stop; }',
    'if header :is "subject" "a" { fileinto "Archive"; stop; }',
    'if header :is "subject" "z2" { fileinto "Zulu"; stop; }'
  ].join("\n");
  const formatted = formatSieveScript(script, {
    sortIfByFileinto: true,
    combineIfWithAnyof: true
  });

  suite.assertTrue(formatted.indexOf('fileinto "Archive";')
    < formatted.indexOf("if anyof ("));
  suite.assertEquals(formatted.match(/fileinto "Zulu";/gu)?.length, 1);
  suite.parseScript(formatted, ["fileinto"]);
});

suite.add("Sieve formatter keeps safe if blocks independent by default", function () {
  const formatted = formatSieveScript([
    'if true { fileinto "Archive"; stop; }',
    'if false { fileinto "Archive"; stop; }'
  ].join("\n"));

  suite.assertFalse(formatted.includes("anyof"));
  suite.assertEquals(formatted.match(/fileinto "Archive";/gu)?.length, 2);
});

suite.add("Sieve formatter anyof combining is idempotent", function () {
  const options = { combineIfWithAnyof: true };
  const once = formatSieveScript([
    'if true { fileinto "Archive"; stop; }',
    'if false { fileinto "Archive"; stop; }'
  ].join("\n"), options);

  suite.assertEquals(formatSieveScript(once, options), once);
});

suite.add("Sieve formatter adds :create and the mailbox requirement", function () {
  const formatted = formatSieveScript([
    '# capabilities',
    'require ["fileinto", "copy"];',
    '# rules',
    'if true {',
    'fileinto :copy "Archive";',
    'fileinto :CREATE "Existing";',
    '}'
  ].join("\n"), {
    ensureFileintoCreate: true,
    combineRequires: true
  });

  suite.assertEquals(formatted, [
    '# capabilities',
    'require [',
    '\t"fileinto",',
    '\t"copy",',
    '\t"mailbox"',
    '];',
    '# rules',
    'if true {',
    '\tfileinto :copy :create "Archive";',
    '\tfileinto :CREATE "Existing";',
    '}',
    ''
  ].join("\n"));
  suite.parseScript(formatted, ["fileinto", "copy", "mailbox"]);
});

suite.add("Sieve formatter fileinto creation preserves opaque content", function () {
  const formatted = formatSieveScript([
    'require ["fileinto", "mailbox"];',
    '# fileinto "Comment";',
    'if header :contains "subject" "fileinto in a string" {',
    'fileinto # destination',
    '"Archive";',
    'fileinto text:',
    'fileinto "Multiline content";',
    '.',
    ';',
    '}'
  ].join("\n"), { ensureFileintoCreate: true });

  suite.assertTrue(formatted.includes('# fileinto "Comment";'));
  suite.assertTrue(formatted.includes('"fileinto in a string"'));
  suite.assertTrue(formatted.includes([
    '\tfileinto # destination',
    '\t:create "Archive";'
  ].join("\n")));
  suite.assertTrue(formatted.includes([
    '\tfileinto :create text:',
    'fileinto "Multiline content";',
    '.',
    '\t;'
  ].join("\n")));
  suite.assertEquals(formatted.match(/"mailbox"/gu)?.length, 1);
  suite.parseScript(formatted, ["fileinto", "mailbox"]);
});

suite.add("Sieve formatter fileinto creation is conservative and optional", function () {
  const source = 'require "fileinto"; fileinto "Archive";';
  const withoutOption = formatSieveScript(source);
  const malformedRequire = formatSieveScript(
    'require ["fileinto",]; fileinto "Archive";',
    { ensureFileintoCreate: true });
  const withoutAction = formatSieveScript(
    'if header :contains "subject" "fileinto" { keep; }',
    { ensureFileintoCreate: true });

  suite.assertFalse(withoutOption.includes(":create"));
  suite.assertFalse(malformedRequire.includes(":create"));
  suite.assertFalse(malformedRequire.includes('"mailbox"'));
  suite.assertFalse(withoutAction.includes('require "mailbox"'));
});

suite.add("Sieve formatter fileinto creation is idempotent", function () {
  const options = {
    ensureFileintoCreate: true,
    combineRequires: true,
    blankLineAfterRequires: true
  };
  const once = formatSieveScript([
    'require "fileinto";',
    '# rule',
    'fileinto "Archive";'
  ].join("\n"), options);

  suite.assertEquals(formatSieveScript(once, options), once);
});

suite.add("Sieve formatter preserves opaque source contents", function () {
  const script = [
    '# leading { comment; }',
    'if header :contains "subject" "{quoted; value}" {',
    '/* block { comment; } */ vacation :mime text:',
    'Body { remains; unchanged }',
    '..dot-stuffed',
    '.',
    ';',
    '}'
  ].join("\n");
  const formatted = formatSieveScript(script);

  suite.assertTrue(formatted.includes('# leading { comment; }'));
  suite.assertTrue(formatted.includes('"{quoted; value}"'));
  suite.assertTrue(formatted.includes('/* block { comment; } */'));
  suite.assertTrue(formatted.includes([
    'text:',
    'Body { remains; unchanged }',
    '..dot-stuffed',
    '.'
  ].join("\n")));
});

suite.add("Sieve formatter is idempotent", function () {
  const options = {
    blankLineAfterRequires: true,
    blankLineAfterIf: true,
    sortIfByFileinto: true
  };
  const once = formatSieveScript(
    'require "fileinto";if allof(true,false){discard;}keep;', options);

  suite.assertEquals(formatSieveScript(once, options), once);
});

suite.add("Formatted Sieve remains valid", function () {
  const formatted = formatSieveScript([
    'require ["fileinto", "vacation"];',
    'if allof (true, not false) {',
    'fileinto "Archive";',
    'vacation text:',
    'Body { remains; unchanged }',
    '.',
    ';',
    '}'
  ].join("\r\n"));

  suite.parseScript(formatted, ["fileinto", "vacation"]);
});

suite.add("Text editor applies formatting as an undoable edit", function () {
  let value = "if true{keep;}";
  let editOrigin = null;
  let focused = false;

  const cm = {
    focus() { focused = true; },
    getCursor() { return { line: 0, ch: 0 }; },
    getLine() { return value; },
    getValue() { return value; },
    indexFromPos() { return 0; },
    lastLine() { return 0; },
    operation(callback) { callback(); },
    posFromIndex() { return { line: 0, ch: 0 }; },
    replaceRange(replacement, start, end, origin) {
      value = replacement;
      editOrigin = origin;
    },
    setCursor() {}
  };

  SieveTextEditorUI.prototype.format.call({
    cm,
    getFormatBlankLineAfterIf() { return false; },
    getFormatBlankLineAfterRequires() { return false; },
    getFormatBraceOnNewLine() { return false; },
    getFormatCombineIfWithAnyof() { return false; },
    getFormatCombineRequires() { return false; },
    getFormatFileintoCreate() { return false; },
    getFormatIgnoreCompactLineBreaks() { return false; },
    getFormatMultilineLists() { return true; },
    getFormatMultilineTests() { return true; },
    getFormatSortIfByFileinto() { return false; },
    getIndentWidth() { return 2; },
    getIndentWithTabs() { return true; }
  });

  suite.assertEquals(value, "if true {\n\tkeep;\n}\n");
  suite.assertEquals(editOrigin, "+format");
  suite.assertTrue(focused);
});

suite.add("Text editor loads formatter preferences", async function () {
  const preferences = {
    "tabulator-width": 4,
    "indentation-policy": false,
    "indentation-width": 3,
    "format-lists-multiline": false,
    "format-tests-multiline": true,
    "format-compact-ignore-line-breaks": true,
    "format-brace-new-line": true,
    "format-requires-combined": true,
    "format-blank-line-after-requires": true,
    "format-blank-line-after-if": false,
    "format-sort-if-by-fileinto": true,
    "format-combine-if-with-anyof": true,
    "format-fileinto-create": true
  };
  const loaded = {};
  const editor = {
    getController() {
      return {
        async getPreference(name) { return preferences[name]; }
      };
    },
    async setFormatBlankLineAfterIf(value) { loaded.blankLineAfterIf = value; },
    async setFormatBlankLineAfterRequires(value) { loaded.blankLineAfterRequires = value; },
    async setFormatBraceOnNewLine(value) { loaded.braces = value; },
    async setFormatCombineIfWithAnyof(value) { loaded.combineIfWithAnyof = value; },
    async setFormatCombineRequires(value) { loaded.requires = value; },
    async setFormatFileintoCreate(value) { loaded.fileintoCreate = value; },
    async setFormatIgnoreCompactLineBreaks(value) { loaded.ignoreCompactLineBreaks = value; },
    async setFormatMultilineLists(value) { loaded.lists = value; },
    async setFormatMultilineTests(value) { loaded.tests = value; },
    async setFormatSortIfByFileinto(value) { loaded.sortIfByFileinto = value; },
    async setIndentWidth(value) { loaded.indentWidth = value; },
    async setIndentWithTabs(value) { loaded.indentWithTabs = value; },
    async setTabWidth(value) { loaded.tabWidth = value; }
  };

  await SieveTextEditorUI.prototype.loadSettings.call(editor);

  suite.assertEquals(JSON.stringify(loaded), JSON.stringify({
    tabWidth: 4,
    indentWithTabs: false,
    indentWidth: 3,
    lists: false,
    tests: true,
    ignoreCompactLineBreaks: true,
    braces: true,
    requires: true,
    blankLineAfterRequires: true,
    blankLineAfterIf: false,
    sortIfByFileinto: true,
    combineIfWithAnyof: true,
    fileintoCreate: true
  }));
});

suite.add("Text editor persists formatter preferences", async function () {
  const saved = {};
  const editor = {
    getController() {
      return {
        async setPreference(name, value) { saved[name] = value; }
      };
    }
  };

  await SieveTextEditorUI.prototype.setFormatBlankLineAfterRequires.call(editor, true);
  await SieveTextEditorUI.prototype.setFormatBlankLineAfterIf.call(editor, true);
  await SieveTextEditorUI.prototype.setFormatCombineIfWithAnyof.call(editor, true);
  await SieveTextEditorUI.prototype.setFormatFileintoCreate.call(editor, true);
  await SieveTextEditorUI.prototype.setFormatIgnoreCompactLineBreaks.call(editor, true);
  await SieveTextEditorUI.prototype.setFormatSortIfByFileinto.call(editor, true);

  suite.assertTrue(SieveTextEditorUI.prototype.getFormatBlankLineAfterRequires.call(editor));
  suite.assertTrue(SieveTextEditorUI.prototype.getFormatBlankLineAfterIf.call(editor));
  suite.assertTrue(SieveTextEditorUI.prototype.getFormatCombineIfWithAnyof.call(editor));
  suite.assertTrue(SieveTextEditorUI.prototype.getFormatFileintoCreate.call(editor));
  suite.assertTrue(SieveTextEditorUI.prototype.getFormatIgnoreCompactLineBreaks.call(editor));
  suite.assertTrue(SieveTextEditorUI.prototype.getFormatSortIfByFileinto.call(editor));
  suite.assertTrue(saved["format-blank-line-after-requires"]);
  suite.assertTrue(saved["format-blank-line-after-if"]);
  suite.assertTrue(saved["format-combine-if-with-anyof"]);
  suite.assertTrue(saved["format-fileinto-create"]);
  suite.assertTrue(saved["format-compact-ignore-line-breaks"]);
  suite.assertTrue(saved["format-sort-if-by-fileinto"]);
});

suite.add("Formatter preferences have stable defaults", async function () {
  const settings = new SieveEditorSettings({
    async getBoolean(name, fallback) { return fallback; }
  });

  suite.assertTrue(await settings.getValue("format-lists-multiline"));
  suite.assertTrue(await settings.getValue("format-tests-multiline"));
  suite.assertFalse(await settings.getValue("format-compact-ignore-line-breaks"));
  suite.assertFalse(await settings.getValue("format-brace-new-line"));
  suite.assertFalse(await settings.getValue("format-requires-combined"));
  suite.assertFalse(await settings.getValue("format-blank-line-after-requires"));
  suite.assertFalse(await settings.getValue("format-blank-line-after-if"));
  suite.assertFalse(await settings.getValue("format-sort-if-by-fileinto"));
  suite.assertFalse(await settings.getValue("format-combine-if-with-anyof"));
  suite.assertFalse(await settings.getValue("format-fileinto-create"));
});
