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

  mailbox = `${mailbox || ""}`.trim() || "INBOX";

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
  snippet = `${snippet || ""}`.trim();
  if (!snippet)
    throw new Error("The Sieve rule is empty");
  if (/^\s*require\b/iu.test(snippet)) {
    throw new Error(
      "Do not add require commands here; required capabilities are managed automatically");
  }

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

  const existing = getRequirements(content);
  const missing = getInboxRuleRequirements(snippet)
    .filter((item) => { return !existing.has(item); });
  if (missing.length) {
    const requirement = `require [${missing.map(quoteSieve).join(", ")}];${lineEnding}`;
    content = content.charCodeAt(0) === 0xFEFF
      ? content[0] + requirement + content.slice(1)
      : requirement + content;
  }

  return content;
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

export {
  appendInboxRuleToScript,
  createInboxRuleTemplate,
  getInboxRuleRequirements,
  inspectInboxRuleMailboxes
};
