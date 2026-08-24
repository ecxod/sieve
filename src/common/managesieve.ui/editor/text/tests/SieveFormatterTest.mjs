/* global net */

const suite = net.tschmid.yautt.test;

if (!suite)
  throw new Error("Could not initialize test suite");

import { formatSieveScript } from "./../SieveFormatter.mjs";
import { SieveTextEditorUI } from "./../SieveTextEditor.mjs";

suite.add("Sieve formatter adds structural line breaks and tabs", function () {
  const script = 'require["fileinto","copy"];if true{fileinto :copy "Archive";stop;}else{keep;}';
  const expected = [
    'require ["fileinto", "copy"];',
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
  const once = formatSieveScript('if allof(true,false){discard;}');

  suite.assertEquals(formatSieveScript(once), once);
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

  SieveTextEditorUI.prototype.format.call({ cm });

  suite.assertEquals(value, "if true {\n\tkeep;\n}\n");
  suite.assertEquals(editOrigin, "+format");
  suite.assertTrue(focused);
});
