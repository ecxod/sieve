/*
 * Helpers for creating and safely appending rules from the Inbox tab.
 */

import {
  inspectFileintoActions
} from "./../editor/text/SieveFormatter.mjs";
import {
  getRequirements,
  normalizeAddress,
  quoteSieve
} from "./../spam/SieveSpamRule.mjs";

const RULE_BEGIN = "# BEGIN sieve-inbox-rule ";
const RULE_END = "# END sieve-inbox-rule ";

/**
 * Produces a stable short identifier without exposing message data.
 *
 * @param {string} source
 *   rule source.
 * @returns {string}
 *   hexadecimal identifier.
 */
function hashRule(source) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Removes newlines from a value before placing it in a Sieve comment.
 *
 * @param {*} value
 *   arbitrary value.
 * @returns {string}
 *   one safe comment line.
 */
function commentText(value) {
  return `${value || ""}`.replace(/[\r\n]+/g, " ").trim().slice(0, 160);
}

/**
 * Skips whitespace and comments without interpreting quoted or multiline
 * string contents.
 *
 * @param {string} source
 *   Sieve source.
 * @param {number} offset
 *   current source offset.
 * @returns {number}
 *   offset of the next structural token.
 */
function skipSieveTrivia(source, offset) {
  while (offset < source.length) {
    if (/\s/u.test(source[offset])) {
      offset++;
      continue;
    }

    if (source[offset] === "#") {
      const end = source.indexOf("\n", offset);
      offset = end === -1 ? source.length : end + 1;
      continue;
    }

    if (source.startsWith("/*", offset)) {
      const end = source.indexOf("*/", offset + 2);
      offset = end === -1 ? source.length : end + 2;
      continue;
    }

    break;
  }

  return offset;
}

/**
 * Skips one quoted Sieve string, including escaped quote characters.
 *
 * @param {string} source
 *   Sieve source.
 * @param {number} offset
 *   offset directly after the opening quote.
 * @returns {number}
 *   offset directly after the closing quote or at the end of the source.
 */
function skipQuotedSieveString(source, offset) {
  let escaped = false;

  while (offset < source.length) {
    const character = source[offset++];
    if (character === "\"" && !escaped)
      break;
    escaped = character === "\\" && !escaped;
    if (character !== "\\")
      escaped = false;
  }

  return offset;
}

/**
 * Removes the leading require commands which the graphical editor generates
 * automatically. Inbox rules are snippets; their requirements are inserted
 * into the selected complete server script by appendInboxRuleToScript().
 *
 * Leading comments and all rule contents remain byte-for-byte unchanged.
 * A malformed require command is left untouched so it can be reported by the
 * server-side syntax check.
 *
 * @param {string} source
 *   source serialized by the graphical editor.
 * @returns {string}
 *   rule snippet without its generated leading require commands.
 */
function stripLeadingSieveRequirements(source) {
  source = `${source || ""}`;
  const ranges = [];
  let offset = 0;

  while (offset < source.length) {
    offset = skipSieveTrivia(source, offset);
    const start = offset;
    const keyword = source.slice(offset).match(/^require\b/iu);
    if (!keyword)
      break;

    offset += keyword[0].length;
    let complete = false;

    while (offset < source.length) {
      if (source[offset] === "\"") {
        offset = skipQuotedSieveString(source, offset + 1);
        continue;
      }

      if (source[offset] === "#") {
        const end = source.indexOf("\n", offset);
        offset = end === -1 ? source.length : end + 1;
        continue;
      }

      if (source.startsWith("/*", offset)) {
        const end = source.indexOf("*/", offset + 2);
        offset = end === -1 ? source.length : end + 2;
        continue;
      }

      if (source[offset++] !== ";")
        continue;

      while (offset < source.length && /[\t ]/u.test(source[offset]))
        offset++;
      if (source[offset] === "\r")
        offset++;
      if (source[offset] === "\n")
        offset++;
      ranges.push({ start, end: offset });
      complete = true;
      break;
    }

    if (!complete)
      return source;
  }

  for (let index = ranges.length - 1; index >= 0; index--)
    source = source.slice(0, ranges[index].start) + source.slice(ranges[index].end);

  return source;
}

/**
 * Normalizes only the RFC-defined case-insensitive INBOX path component.
 *
 * @param {string} mailbox
 *   mailbox path.
 * @returns {string}
 *   comparison value.
 */
function normalizeMailbox(mailbox) {
  const value = `${mailbox || ""}`.replace(/^\/+/, "");
  return value.replace(/^inbox(?=\/|$)/iu, "INBOX");
}

/**
 * Builds a conservative sender rule template for an Inbox message.
 *
 * @param {object} details
 *   selected message details.
 * @param {string} mailbox
 *   initial destination mailbox.
 * @returns {string}
 *   editable Sieve rule body without a require command.
 */
function createInboxRuleTemplate(details, mailbox) {
  const sender = normalizeAddress(details?.senderAddress);
  const subject = `${details?.subject || ""}`.trim();
  let test;

  if (sender)
    test = `address :is "from" ${quoteSieve(sender)}`;
  else if (subject)
    test = `header :contains "Subject" ${quoteSieve(subject)}`;
  else
    throw new Error("The message has neither a usable sender nor a subject");

  mailbox = normalizeMailbox(mailbox) || "INBOX";

  return [
    `# Created from Inbox: ${commentText(subject || sender)}`,
    `if ${test} {`,
    `\tfileinto :create ${quoteSieve(mailbox)};`,
    "\tstop;",
    "}"
  ].join("\n");
}

/**
 * Returns capabilities needed by literal fileinto actions in a snippet.
 *
 * @param {string} snippet
 *   editable rule body.
 * @returns {string[]}
 *   capabilities in stable order.
 */
function getInboxRuleRequirements(snippet) {
  const actions = inspectFileintoActions(snippet);
  const requirements = [];

  if (actions.length)
    requirements.push("fileinto");
  if (actions.some((action) => { return action.tags.includes(":copy"); }))
    requirements.push("copy");
  if (actions.some((action) => { return action.tags.includes(":create"); }))
    requirements.push("mailbox");

  return requirements;
}

/**
 * Adds capabilities required by an Inbox rule to a complete Sieve script.
 *
 * @param {string} content
 *   complete Sieve script.
 * @param {string} snippet
 *   added or replaced Inbox rule.
 * @returns {string}
 *   script with any missing require command.
 */
function addInboxRuleRequirements(content, snippet) {
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const existing = getRequirements(content);
  const missing = getInboxRuleRequirements(snippet)
    .filter((item) => { return !existing.has(item); });
  if (!missing.length)
    return content;

  const requirement = `require [${missing.map(quoteSieve).join(", ")}];${lineEnding}`;
  return content.charCodeAt(0) === 0xFEFF
    ? content[0] + requirement + content.slice(1)
    : requirement + content;
}

/**
 * Validates and normalizes a rule snippet before it changes a server script.
 *
 * @param {string} snippet
 *   editable rule body.
 * @returns {string}
 *   trimmed rule body.
 */
function normalizeInboxRuleSnippet(snippet) {
  snippet = `${snippet || ""}`.trim();
  if (!snippet)
    throw new Error("The Sieve rule is empty");
  if (stripLeadingSieveRequirements(snippet) !== snippet) {
    throw new Error(
      "Do not add require commands here; required capabilities are managed automatically");
  }
  return snippet;
}

/**
 * Appends an editable Inbox rule body and injects missing requirements.
 *
 * @param {string} script
 *   current complete server script.
 * @param {string} snippet
 *   rule body entered in the Inbox helper.
 * @returns {string}
 *   complete updated server script.
 */
function appendInboxRuleToScript(script, snippet) {
  snippet = normalizeInboxRuleSnippet(snippet);

  const id = `inbox-rule-${hashRule(snippet)}`;
  const marker = `# sieve-inbox-rule-id: ${id}`;
  let content = `${script || ""}`;
  if (content.includes(marker))
    throw new Error("This Inbox rule already exists in the selected script");

  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  if (content && !content.endsWith("\n") && !content.endsWith("\r"))
    content += lineEnding;
  if (content.trim())
    content += lineEnding;

  const block = [
    `${RULE_BEGIN}${id}`,
    marker,
    snippet,
    `${RULE_END}${id}`,
    ""
  ].join("\n").replace(/\n/g, lineEnding);
  content += block;

  return addInboxRuleRequirements(content, snippet);
}

/**
 * Replaces one unchanged if block previously loaded from a server script.
 * The exact source range prevents a similar-looking rule from being changed.
 *
 * @param {string} script
 *   current complete server script.
 * @param {string} snippet
 *   edited if block.
 * @param {{ start: number, end: number, source: string }} edit
 *   exact original source selection.
 * @returns {string}
 *   complete updated server script.
 */
function replaceInboxRuleInScript(script, snippet, edit) {
  const content = `${script || ""}`;
  snippet = normalizeInboxRuleSnippet(snippet);
  if (!Number.isInteger(edit?.start) || !Number.isInteger(edit?.end)
      || edit.start < 0 || edit.end <= edit.start || edit.end > content.length
      || content.slice(edit.start, edit.end) !== edit.source) {
    throw new Error(
      "The selected existing rule changed; reopen the Inbox rule editor");
  }

  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const replacement = snippet.replace(/\r?\n/gu, lineEnding);
  const updated = content.slice(0, edit.start)
    + replacement + content.slice(edit.end);
  return addInboxRuleRequirements(updated, snippet);
}

/**
 * Compares literal fileinto targets with the account's IMAP folder list.
 *
 * @param {string} snippet
 *   editable rule body.
 * @param {string[]} mailboxes
 *   selectable IMAP mailbox paths.
 * @returns {{ state: string, existing: string[], missing: string[], unverifiable: number }}
 *   status for the Inbox helper.
 */
function inspectInboxRuleMailboxes(snippet, mailboxes) {
  const available = new Set((mailboxes || []).map(normalizeMailbox));
  const actions = inspectFileintoActions(snippet);
  const existing = [];
  const missing = [];
  let unverifiable = 0;

  for (const action of actions) {
    if (action.mailbox === null) {
      unverifiable++;
      continue;
    }

    if (available.has(normalizeMailbox(action.mailbox)))
      existing.push(action.mailbox);
    else
      missing.push(action.mailbox);
  }

  let state = "ok";
  if (!actions.length)
    state = "none";
  else if (missing.length || unverifiable)
    state = "warning";

  return {
    state,
    existing: [...new Set(existing)],
    missing: [...new Set(missing)],
    unverifiable
  };
}

/**
 * Returns the literal fileinto destinations used by a complete Sieve script.
 *
 * Dynamic destinations are deliberately omitted because creating a guessed
 * mailbox would be a destructive and surprising side effect.
 *
 * @param {string} script
 *   complete Sieve source.
 * @returns {string[]}
 *   unique, non-empty literal mailbox names in source order.
 */
function getLiteralFileintoMailboxes(script) {
  const result = [];
  const seen = new Set();

  for (const action of inspectFileintoActions(script)) {
    const mailbox = action.mailbox?.trim();
    if (!mailbox)
      continue;

    const normalized = normalizeMailbox(mailbox);
    if (seen.has(normalized))
      continue;

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export {
  appendInboxRuleToScript,
  createInboxRuleTemplate,
  getLiteralFileintoMailboxes,
  getInboxRuleRequirements,
  inspectInboxRuleMailboxes,
  replaceInboxRuleInScript,
  stripLeadingSieveRequirements
};
