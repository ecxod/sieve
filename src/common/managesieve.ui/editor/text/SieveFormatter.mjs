/*
 * The content of this file is licensed. You may obtain a copy of
 * the license at https://github.com/thsmi/sieve/ or request it via
 * email from the author.
 *
 * Do not remove or change this comment.
 *
 * The initial author of the code is:
 *   Thomas Schmid <schmid-thomas@gmx.net>
 */

const SYMBOLS = new Set(["{", "}", "(", ")", "[", "]", ",", ";"]);

/**
 * Reads a Sieve multiline string without interpreting its contents.
 *
 * @param {string} script
 *   the normalized script.
 * @param {int} start
 *   the offset of the text: token.
 * @returns {{ value: string, end: int }}
 *   the complete multiline string and its end offset.
 */
function readMultilineString(script, start) {
  let end = script.indexOf("\n", start);

  if (end === -1)
    return { value: script.slice(start), end: script.length };

  end++;

  while (end < script.length) {
    const lineEnd = script.indexOf("\n", end);
    const next = (lineEnd === -1) ? script.length : lineEnd + 1;
    const line = script.slice(end, (lineEnd === -1) ? script.length : lineEnd);

    end = next;

    if (line === ".")
      break;
  }

  return { value: script.slice(start, end), end };
}

/**
 * Splits Sieve source into tokens while keeping strings and comments opaque.
 *
 * @param {string} script
 *   the script to tokenize.
 * @returns {Array<{ type: string, value: string }>}
 *   the tokens in source order.
 */
function tokenize(script) {
  const tokens = [];
  let offset = 0;

  while (offset < script.length) {
    const character = script[offset];

    if (/\s/.test(character)) {
      offset++;
      continue;
    }

    if (character === "#") {
      let end = script.indexOf("\n", offset);

      if (end === -1)
        end = script.length;

      tokens.push({ type: "line-comment", value: script.slice(offset, end) });
      offset = end;
      continue;
    }

    if (script.startsWith("/*", offset)) {
      let end = script.indexOf("*/", offset + 2);

      end = (end === -1) ? script.length : end + 2;
      tokens.push({ type: "block-comment", value: script.slice(offset, end) });
      offset = end;
      continue;
    }

    if (character === "\"") {
      let end = offset + 1;
      let escaped = false;

      while (end < script.length) {
        const current = script[end++];

        if (current === "\"" && !escaped)
          break;

        escaped = current === "\\" && !escaped;

        if (current !== "\\")
          escaped = false;
      }

      tokens.push({ type: "value", value: script.slice(offset, end) });
      offset = end;
      continue;
    }

    if (script.slice(offset, offset + "text:".length).toLowerCase() === "text:") {
      const multiline = readMultilineString(script, offset);

      tokens.push({ type: "multiline", value: multiline.value });
      offset = multiline.end;
      continue;
    }

    if (SYMBOLS.has(character)) {
      tokens.push({ type: "symbol", value: character });
      offset++;
      continue;
    }

    let end = offset + 1;

    while (end < script.length
      && !/\s/.test(script[end])
      && !SYMBOLS.has(script[end])
      && script[end] !== "#"
      && script[end] !== "\"") {

      if (script.startsWith("/*", end))
        break;

      end++;
    }

    tokens.push({ type: "value", value: script.slice(offset, end) });
    offset = end;
  }

  return tokens;
}

/**
 * Formats Sieve source with tabs and structural line breaks.
 *
 * Quoted strings, multiline strings and comments are treated as opaque so
 * their contents are not changed.
 *
 * @param {string} script
 *   the Sieve source.
 * @returns {string}
 *   the formatted source using LF line endings for CodeMirror.
 */
function formatSieveScript(script) {
  script = script.replace(/\r\n|\r/g, "\n");

  if (script.trim() === "")
    return "";

  const lines = [];
  let current = "";
  let indentation = 0;

  const startLine = () => {
    if (current === "")
      current = "\t".repeat(indentation);
  };

  const finishLine = () => {
    if (current.trim() !== "")
      lines.push(current.trimEnd());

    current = "";
  };

  const append = (value, separate = true) => {
    startLine();

    if (separate && current.trim() !== "" && !/[\s([{]$/.test(current))
      current += " ";

    current += value;
  };

  const appendMultiline = (value) => {
    const parts = value.split("\n");

    append(parts.shift());
    finishLine();

    while (parts.length > 1)
      lines.push(parts.shift());

    if (parts.length && parts[0] !== "")
      current = parts[0];
  };

  for (const token of tokenize(script)) {
    if (token.type === "line-comment") {
      append(token.value);
      finishLine();
      continue;
    }

    if (token.type === "block-comment") {
      const commentLines = token.value.split("\n");

      append(commentLines.shift());

      while (commentLines.length) {
        finishLine();
        current = commentLines.shift();
      }

      continue;
    }

    if (token.type === "multiline") {
      appendMultiline(token.value);
      continue;
    }

    if (token.type !== "symbol") {
      append(token.value);
      continue;
    }

    if (token.value === "{") {
      append("{");
      finishLine();
      indentation++;
      continue;
    }

    if (token.value === "}") {
      finishLine();
      indentation = Math.max(0, indentation - 1);
      append("}", false);
      finishLine();
      continue;
    }

    if (token.value === ";") {
      append(";", false);
      finishLine();
      continue;
    }

    if (token.value === ",") {
      append(",", false);
      current += " ";
      continue;
    }

    if (token.value === ")" || token.value === "]") {
      current = current.trimEnd();
      append(token.value, false);
      continue;
    }

    append(token.value);
  }

  finishLine();

  return `${lines.join("\n")}\n`;
}

export { formatSieveScript };
