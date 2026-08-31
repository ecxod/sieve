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
    getFormatCombineRequires() { return false; },
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
    "format-sort-if-by-fileinto": true
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
    async setFormatCombineRequires(value) { loaded.requires = value; },
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
    sortIfByFileinto: true
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
  await SieveTextEditorUI.prototype.setFormatIgnoreCompactLineBreaks.call(editor, true);
  await SieveTextEditorUI.prototype.setFormatSortIfByFileinto.call(editor, true);

  suite.assertTrue(SieveTextEditorUI.prototype.getFormatBlankLineAfterRequires.call(editor));
  suite.assertTrue(SieveTextEditorUI.prototype.getFormatBlankLineAfterIf.call(editor));
  suite.assertTrue(SieveTextEditorUI.prototype.getFormatIgnoreCompactLineBreaks.call(editor));
  suite.assertTrue(SieveTextEditorUI.prototype.getFormatSortIfByFileinto.call(editor));
  suite.assertTrue(saved["format-blank-line-after-requires"]);
  suite.assertTrue(saved["format-blank-line-after-if"]);
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
});
