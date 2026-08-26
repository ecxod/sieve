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
    blankLineAfterIf: true
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
    getFormatMultilineLists() { return true; },
    getFormatMultilineTests() { return true; },
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
    "format-brace-new-line": true,
    "format-requires-combined": true,
    "format-blank-line-after-requires": true,
    "format-blank-line-after-if": false
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
    async setFormatMultilineLists(value) { loaded.lists = value; },
    async setFormatMultilineTests(value) { loaded.tests = value; },
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
    braces: true,
    requires: true,
    blankLineAfterRequires: true,
    blankLineAfterIf: false
  }));
});

suite.add("Text editor persists formatter blank-line preferences", async function () {
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

  suite.assertTrue(SieveTextEditorUI.prototype.getFormatBlankLineAfterRequires.call(editor));
  suite.assertTrue(SieveTextEditorUI.prototype.getFormatBlankLineAfterIf.call(editor));
  suite.assertTrue(saved["format-blank-line-after-requires"]);
  suite.assertTrue(saved["format-blank-line-after-if"]);
});

suite.add("Formatter preferences have stable defaults", async function () {
  const settings = new SieveEditorSettings({
    async getBoolean(name, fallback) { return fallback; }
  });

  suite.assertTrue(await settings.getValue("format-lists-multiline"));
  suite.assertTrue(await settings.getValue("format-tests-multiline"));
  suite.assertFalse(await settings.getValue("format-brace-new-line"));
  suite.assertFalse(await settings.getValue("format-requires-combined"));
  suite.assertFalse(await settings.getValue("format-blank-line-after-requires"));
  suite.assertFalse(await settings.getValue("format-blank-line-after-if"));
});
