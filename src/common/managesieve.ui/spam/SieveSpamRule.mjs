/*
 * Generates conservative Sieve rules from messages selected in the Spam tab
 * and finds message parameters in existing server scripts.
 */

const RULE_BEGIN = "# BEGIN sieve-spam-rule ";
const RULE_END = "# END sieve-spam-rule ";
const ALLOWED_CRITERIA = new Set(["sender", "domain", "recipient", "subject"]);
const ALLOWED_ACTIONS = new Set(["fileinto", "keep", "discard"]);

/**
 * Quotes arbitrary text as a Sieve string.
 *
 * @param {*} value
 *   value to quote.
 * @returns {string}
 *   quoted Sieve string.
 */
function quoteSieve(value) {
  return `"${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

/**
 * Produces a stable short identifier.
 *
 * @param {string} source
 *   source text.
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
 * Normalizes an email address.
 *
 * @param {*} value
 *   possible address.
 * @returns {string}
 *   trimmed lowercase address.
 */
function normalizeAddress(value) {
  value = `${value || ""}`.trim().toLocaleLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(value) ? value : "";
}

/**
 * Builds a managed Sieve block from message parameters.
 *
 * @param {object} details
 *   message parameters.
 * @param {object} options
 *   selected criteria and action.
 * @returns {object}
 *   rule block, complete standalone script and requirements.
 */
function createSpamRule(details, options) {
  details = details || {};
  options = options || {};
  const selected = [...new Set(options.criteria || [])]
    .filter((criterion) => { return ALLOWED_CRITERIA.has(criterion); });
  const sender = normalizeAddress(details.senderAddress);
  const domain = `${details.senderDomain || ""}`.trim().toLocaleLowerCase();
  const recipients = [...new Set((details.recipientAddresses || [])
    .map(normalizeAddress).filter(Boolean))];
  const subject = `${details.subject || ""}`.trim();
  const tests = [];
  const descriptions = [];

  if (selected.includes("sender") && sender) {
    tests.push(`address :is "from" ${quoteSieve(sender)}`);
    descriptions.push(`From is ${sender}`);
  }
  if (selected.includes("domain") && domain) {
    tests.push(`address :domain :is "from" ${quoteSieve(domain)}`);
    descriptions.push(`From domain is ${domain}`);
  }
  if (selected.includes("recipient") && recipients.length) {
    tests.push(`address :is ["to", "cc"] [${recipients.map(quoteSieve).join(", ")}]`);
    descriptions.push(`Recipient is ${recipients.join(", ")}`);
  }
  if (selected.includes("subject") && subject) {
    tests.push(`header :contains "Subject" ${quoteSieve(subject)}`);
    descriptions.push(`Subject contains ${subject}`);
  }

  if (!tests.length)
    throw new Error("Select at least one available rule criterion");

  const action = ALLOWED_ACTIONS.has(options.action) ? options.action : "fileinto";
  const requirements = [];
  const commands = [];
  if (action === "fileinto") {
    const mailbox = `${options.mailbox || ""}`.trim();
    if (!mailbox)
      throw new Error("A destination mailbox is required");
    requirements.push("fileinto");
    commands.push(`fileinto ${quoteSieve(mailbox)};`, "stop;");
  } else if (action === "keep") {
    commands.push("keep;", "stop;");
  } else {
    commands.push("discard;", "stop;");
  }

  const expression = tests.length === 1 ? tests[0] : `allof(${tests.join(", ")})`;
  const identity = JSON.stringify({ selected, sender, domain, recipients, subject, action, mailbox: options.mailbox });
  const id = `spam-rule-${hashRule(identity)}`;
  const lines = [
    `${RULE_BEGIN}${id}`,
    `# Created from Spam tab: ${descriptions.join(" AND ").replace(/[\r\n]+/g, " ")}`,
    `# sieve-spam-rule-id: ${id}`,
    `if ${expression} {`,
    ...commands.map((command) => { return `  ${command}`; }),
    "}",
    `${RULE_END}${id}`
  ];
  const block = `${lines.join("\n")}\n`;
  const requireLine = requirements.length
    ? `require [${requirements.map(quoteSieve).join(", ")}];\n\n` : "";

  return {
    id,
    block,
    sieve: `${requireLine}${block}`,
    requirements,
    descriptions
  };
}

/**
 * Reads requirements already declared by a script.
 *
 * @param {string} script
 *   Sieve script.
 * @returns {Set<string>}
 *   declared capabilities.
 */
function getRequirements(script) {
  const result = new Set();
  const commands = /^[\t ]*require\b([\s\S]*?);/gim;
  let command;
  while ((command = commands.exec(script)) !== null) {
    const strings = /"((?:\\.|[^"\\])*)"/g;
    let value;
    while ((value = strings.exec(command[1])) !== null)
      result.add(value[1].replace(/\\(["\\])/g, "$1"));
  }
  return result;
}

/**
 * Safely appends a generated spam rule and missing requirements.
 *
 * @param {string} script
 *   current server script.
 * @param {object} rule
 *   generated rule.
 * @returns {string}
 *   updated server script.
 */
function appendSpamRuleToScript(script, rule) {
  let content = `${script || ""}`;
  if (content.includes(`# sieve-spam-rule-id: ${rule.id}`))
    throw new Error("This generated rule already exists in the selected script");

  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  if (content && !content.endsWith("\n") && !content.endsWith("\r"))
    content += lineEnding;
  if (content.trim())
    content += lineEnding;
  content += rule.block.replace(/\n/g, lineEnding);

  const existing = getRequirements(content);
  const missing = rule.requirements.filter((item) => { return !existing.has(item); });
  if (missing.length) {
    const requirement = `require [${missing.map(quoteSieve).join(", ")}];${lineEnding}`;
    content = content.charCodeAt(0) === 0xFEFF
      ? content[0] + requirement + content.slice(1)
      : requirement + content;
  }

  return content;
}

/**
 * Finds matching message parameters and source lines in server scripts.
 *
 * @param {object[]} scripts
 *   scripts with name and content.
 * @param {object} details
 *   message parameters.
 * @returns {object[]}
 *   matching scripts and line excerpts.
 */
function findSpamRuleMatches(scripts, details) {
  details = details || {};
  const parameters = [];
  const sender = normalizeAddress(details.senderAddress);
  const domain = `${details.senderDomain || ""}`.trim().toLocaleLowerCase();
  const subject = `${details.subject || ""}`.trim();

  if (sender)
    parameters.push({ type: "sender", value: sender });
  if (domain)
    parameters.push({ type: "domain", value: domain });
  for (const recipient of details.recipientAddresses || []) {
    const address = normalizeAddress(recipient);
    if (address)
      parameters.push({ type: "recipient", value: address });
  }
  if (subject)
    parameters.push({ type: "subject", value: subject });

  const results = [];
  for (const script of scripts || []) {
    const lines = `${script.content || ""}`.split(/\r?\n/);
    const matches = [];
    for (const parameter of parameters) {
      const needle = parameter.value.toLocaleLowerCase();
      const occurrences = [];
      lines.forEach((line, index) => {
        if (line.toLocaleLowerCase().includes(needle)) {
          const contextStart = Math.max(0, index - 1);
          const contextEnd = Math.min(lines.length, index + 4);
          occurrences.push({
            line: index + 1,
            excerpt: line.trim().slice(0, 240),
            context: lines.slice(contextStart, contextEnd)
              .map((contextLine, contextIndex) => {
                return `${contextStart + contextIndex + 1}: ${contextLine}`;
              })
              .join("\n")
          });
        }
      });
      if (occurrences.length)
        matches.push({ ...parameter, occurrences });
    }
    if (matches.length) {
      results.push({
        name: script.name,
        active: !!script.active,
        matches
      });
    }
  }
  return results;
}

export {
  appendSpamRuleToScript,
  createSpamRule,
  findSpamRuleMatches,
  getRequirements,
  normalizeAddress,
  quoteSieve
};
