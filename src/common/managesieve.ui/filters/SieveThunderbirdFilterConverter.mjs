/*
 * Converts Thunderbird message-filter data into conservative Sieve snippets.
 * Unsupported or semantically different rules are guarded with `false`, so a
 * user can inspect and edit them without accidentally activating a partial
 * translation.
 */

/* eslint-disable no-magic-numbers -- Thunderbird's public IDL constants are numeric. */

const ATTR = {
  CUSTOM: -2,
  SUBJECT: 0,
  SENDER: 1,
  BODY: 2,
  DATE: 3,
  PRIORITY: 4,
  STATUS: 5,
  TO: 6,
  CC: 7,
  TO_OR_CC: 8,
  ALL_ADDRESSES: 9,
  AGE_IN_DAYS: 12,
  SIZE: 14,
  ANY_TEXT: 15,
  KEYWORDS: 16,
  HAS_ATTACHMENT: 44,
  JUNK_STATUS: 45,
  JUNK_PERCENT: 46,
  JUNK_ORIGIN: 47,
  HDR_PROPERTY: 49,
  FOLDER_FLAG: 50,
  UINT32_HDR_PROPERTY: 51,
  OTHER_HEADER: 52
};

const OP = {
  CONTAINS: 0,
  DOESNT_CONTAIN: 1,
  IS: 2,
  ISNT: 3,
  IS_EMPTY: 4,
  IS_BEFORE: 5,
  IS_AFTER: 6,
  IS_HIGHER_THAN: 7,
  IS_LOWER_THAN: 8,
  BEGINS_WITH: 9,
  ENDS_WITH: 10,
  SOUNDS_LIKE: 11,
  LDAP_DWIM: 12,
  IS_GREATER_THAN: 13,
  IS_LESS_THAN: 14,
  NAME_COMPLETION: 15,
  IS_IN_AB: 16,
  ISNT_IN_AB: 17,
  ISNT_EMPTY: 18,
  MATCHES: 19,
  DOESNT_MATCH: 20
};

const ACTION = {
  CUSTOM: -1,
  NONE: 0,
  MOVE_TO_FOLDER: 1,
  CHANGE_PRIORITY: 2,
  DELETE: 3,
  MARK_READ: 4,
  KILL_THREAD: 5,
  WATCH_THREAD: 6,
  MARK_FLAGGED: 7,
  REPLY: 9,
  FORWARD: 10,
  STOP_EXECUTION: 11,
  DELETE_FROM_POP3: 12,
  LEAVE_ON_POP3: 13,
  JUNK_SCORE: 14,
  FETCH_BODY_FROM_POP3: 15,
  COPY_TO_FOLDER: 16,
  ADD_TAG: 17,
  KILL_SUBTHREAD: 18,
  MARK_UNREAD: 19
};

const FILTER_TYPE_INBOX_RULE = 0x01;
const FILTER_TYPE_POST_PLUGIN = 0x20;
const MANAGED_BLOCK_BEGIN = "# BEGIN thunderbird-sieve-filter ";
const MANAGED_BLOCK_END = "# END thunderbird-sieve-filter ";

const ATTRIBUTE_NAMES = new Map([
  [ATTR.CUSTOM, "Custom condition"],
  [ATTR.SUBJECT, "Subject"],
  [ATTR.SENDER, "From"],
  [ATTR.BODY, "Body"],
  [ATTR.DATE, "Date"],
  [ATTR.PRIORITY, "Priority"],
  [ATTR.STATUS, "Message status"],
  [ATTR.TO, "To"],
  [ATTR.CC, "Cc"],
  [ATTR.TO_OR_CC, "To or Cc"],
  [ATTR.ALL_ADDRESSES, "All addresses"],
  [ATTR.AGE_IN_DAYS, "Age in days"],
  [ATTR.SIZE, "Size"],
  [ATTR.ANY_TEXT, "Any text"],
  [ATTR.KEYWORDS, "Tag"],
  [ATTR.HAS_ATTACHMENT, "Has attachment"],
  [ATTR.JUNK_STATUS, "Junk status"],
  [ATTR.JUNK_PERCENT, "Junk percentage"],
  [ATTR.JUNK_ORIGIN, "Junk origin"],
  [ATTR.HDR_PROPERTY, "Local message property"],
  [ATTR.FOLDER_FLAG, "Folder flag"],
  [ATTR.UINT32_HDR_PROPERTY, "Local numeric property"],
  [ATTR.OTHER_HEADER, "Header"]
]);

const OPERATOR_NAMES = new Map([
  [OP.CONTAINS, "contains"],
  [OP.DOESNT_CONTAIN, "does not contain"],
  [OP.IS, "is"],
  [OP.ISNT, "is not"],
  [OP.IS_EMPTY, "is empty"],
  [OP.IS_BEFORE, "is before"],
  [OP.IS_AFTER, "is after"],
  [OP.IS_HIGHER_THAN, "is higher than"],
  [OP.IS_LOWER_THAN, "is lower than"],
  [OP.BEGINS_WITH, "begins with"],
  [OP.ENDS_WITH, "ends with"],
  [OP.SOUNDS_LIKE, "sounds like"],
  [OP.IS_GREATER_THAN, "is greater than"],
  [OP.IS_LESS_THAN, "is less than"],
  [OP.IS_IN_AB, "is in address book"],
  [OP.ISNT_IN_AB, "is not in address book"],
  [OP.ISNT_EMPTY, "is not empty"],
  [OP.MATCHES, "matches"],
  [OP.DOESNT_MATCH, "does not match"]
]);

const ACTION_NAMES = new Map([
  [ACTION.CUSTOM, "Custom action"],
  [ACTION.MOVE_TO_FOLDER, "Move to folder"],
  [ACTION.CHANGE_PRIORITY, "Change priority"],
  [ACTION.DELETE, "Delete message"],
  [ACTION.MARK_READ, "Mark as read"],
  [ACTION.KILL_THREAD, "Ignore thread"],
  [ACTION.WATCH_THREAD, "Watch thread"],
  [ACTION.MARK_FLAGGED, "Mark as starred"],
  [ACTION.REPLY, "Reply with template"],
  [ACTION.FORWARD, "Forward to"],
  [ACTION.STOP_EXECUTION, "Stop filter execution"],
  [ACTION.DELETE_FROM_POP3, "Delete from POP3 server"],
  [ACTION.LEAVE_ON_POP3, "Leave on POP3 server"],
  [ACTION.JUNK_SCORE, "Set junk status"],
  [ACTION.FETCH_BODY_FROM_POP3, "Fetch body from POP3 server"],
  [ACTION.COPY_TO_FOLDER, "Copy to folder"],
  [ACTION.ADD_TAG, "Add tag"],
  [ACTION.KILL_SUBTHREAD, "Ignore subthread"],
  [ACTION.MARK_UNREAD, "Mark as unread"]
]);

/**
 * Escapes a value as a Sieve quoted string.
 *
 * @param {*} value
 *   the value to quote.
 * @returns {string}
 *   a valid Sieve quoted string.
 */
function quote(value) {
  return `"${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

/**
 * Escapes user text before it is embedded in a :matches wildcard pattern.
 *
 * @param {*} value
 *   the literal user value.
 * @returns {string}
 *   the escaped match-pattern text.
 */
function escapeMatch(value) {
  return String(value ?? "").replace(/([\\*?])/g, "\\$1");
}

/**
 * Renders one or more header names as a Sieve string-list.
 *
 * @param {string[]} headers
 *   header names.
 * @returns {string}
 *   a quoted string or string-list.
 */
function renderHeaders(headers) {
  if (headers.length === 1)
    return quote(headers[0]);
  return `[${headers.map((header) => { return quote(header); }).join(", ")}]`;
}

/**
 * Gets the serializable value which is relevant for a Thunderbird condition.
 *
 * @param {object} term
 *   a serialized Thunderbird search term.
 * @returns {*}
 *   the display and conversion value.
 */
function getTermValue(term) {
  const value = term.value || {};

  switch (term.attrib) {
    case ATTR.DATE:
      return value.date;
    case ATTR.PRIORITY:
      return value.priority;
    case ATTR.STATUS:
    case ATTR.FOLDER_FLAG:
    case ATTR.UINT32_HDR_PROPERTY:
    case ATTR.HAS_ATTACHMENT:
      return value.status;
    case ATTR.AGE_IN_DAYS:
      return value.age;
    case ATTR.SIZE:
      return value.size;
    case ATTR.JUNK_STATUS:
      return value.junkStatus;
    case ATTR.JUNK_PERCENT:
      return value.junkPercent;
    default:
      return value.str || value.utf8Str || "";
  }
}

/**
 * Returns a stable, sorted JSON representation.
 *
 * @param {*} value
 *   the value to serialize.
 * @returns {string}
 *   stable JSON.
 */
function stableStringify(value) {
  if (Array.isArray(value))
    return `[${value.map((item) => { return stableStringify(item); }).join(",")}]`;

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableStringify(value[key])}`;
    }).join(",")}}`;
  }

  return JSON.stringify(value);
}

/**
 * Creates a compact stable identifier for a source filter.
 *
 * @param {object} filter
 *   the serialized Thunderbird filter.
 * @returns {string}
 *   a marker suitable for Sieve comments.
 */
function createFilterId(filter) {
  const source = stableStringify({
    name: filter.name || "",
    filterType: filter.filterType || 0,
    terms: filter.terms || [],
    actions: filter.actions || []
  });
  let hash = 0x811c9dc5;

  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `tb-filter-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Creates a human-readable description for a Thunderbird condition.
 *
 * @param {object} term
 *   the serialized term.
 * @param {number} index
 *   its zero-based position.
 * @returns {string}
 *   the condition description.
 */
function describeTerm(term, index) {
  if (term.matchAll)
    return index ? "AND match all messages" : "Match all messages";

  const connector = index ? (term.booleanAnd ? "AND " : "OR ") : "";
  const opening = term.beginsGrouping ? "(" : "";
  const closing = term.endsGrouping ? ")" : "";
  let attribute = ATTRIBUTE_NAMES.get(term.attrib);

  if (term.attrib >= ATTR.OTHER_HEADER)
    attribute = term.arbitraryHeader || "Header";
  if (term.attrib === ATTR.CUSTOM)
    attribute = term.customId || attribute;

  const operator = OPERATOR_NAMES.get(term.op) || `operator ${term.op}`;
  const value = getTermValue(term);
  const renderedValue = value === "" || value === null ? "" : ` ${JSON.stringify(value)}`;
  return `${connector}${opening}${attribute || `attribute ${term.attrib}`} ${operator}${renderedValue}${closing}`;
}

/**
 * Creates a human-readable description for a Thunderbird action.
 *
 * @param {object} action
 *   the serialized action.
 * @returns {string}
 *   the action description.
 */
function describeAction(action) {
  const label = ACTION_NAMES.get(action.type) || `Action ${action.type}`;
  let value = "";

  if (action.targetFolderUri)
    value = action.targetFolderUri;
  else if (action.strValue)
    value = action.strValue;
  else if (action.type === ACTION.JUNK_SCORE && action.junkScore !== null)
    value = action.junkScore;
  else if (action.type === ACTION.CHANGE_PRIORITY && action.priority !== null)
    value = action.priority;
  else if (action.customId)
    value = action.customId;

  return value === "" ? label : `${label}: ${value}`;
}

/**
 * Converts a Thunderbird text comparison into a Sieve test.
 *
 * @param {object} term
 *   the source term.
 * @param {string} command
 *   `header` or `body`.
 * @param {string[]} headers
 *   header names for the header command.
 * @returns {object}
 *   conversion result.
 */
function convertTextTerm(term, command, headers = []) {
  const value = getTermValue(term);
  const target = command === "header" ? ` ${renderHeaders(headers)}` : "";
  let test;
  let negate = false;

  switch (term.op) {
    case OP.CONTAINS:
      test = `${command} :contains${target} ${quote(value)}`;
      break;
    case OP.DOESNT_CONTAIN:
      test = `${command} :contains${target} ${quote(value)}`;
      negate = true;
      break;
    case OP.IS:
      test = `${command} :is${target} ${quote(value)}`;
      break;
    case OP.ISNT:
      test = `${command} :is${target} ${quote(value)}`;
      negate = true;
      break;
    case OP.BEGINS_WITH:
      test = `${command} :matches${target} ${quote(`${escapeMatch(value)}*`)}`;
      break;
    case OP.ENDS_WITH:
      test = `${command} :matches${target} ${quote(`*${escapeMatch(value)}`)}`;
      break;
    case OP.IS_EMPTY:
    case OP.ISNT_EMPTY:
      if (command !== "header")
        return { supported: false, test: "false", warning: "Empty body tests have no reliable Sieve equivalent." };
      test = `exists ${renderHeaders(headers)}`;
      negate = term.op === OP.IS_EMPTY;
      return {
        supported: false,
        test: negate ? `not ${test}` : test,
        warning: "Thunderbird's empty-header semantics can only be approximated with Sieve exists."
      };
    default:
      return {
        supported: false,
        test: "false",
        warning: `Text operator ${term.op} is not safely translatable.`
      };
  }

  return {
    supported: true,
    test: negate ? `not ${test}` : test,
    requirements: command === "body" ? ["body"] : []
  };
}

/**
 * Converts one Thunderbird condition into a Sieve test.
 *
 * @param {object} term
 *   the source condition.
 * @returns {object}
 *   conversion result.
 */
function convertTerm(term) {
  if (term.matchAll)
    return { supported: true, test: "true", requirements: [] };

  switch (term.attrib) {
    case ATTR.SUBJECT:
      return convertTextTerm(term, "header", ["subject"]);
    case ATTR.SENDER:
      return convertTextTerm(term, "header", ["from"]);
    case ATTR.BODY:
      return convertTextTerm(term, "body");
    case ATTR.TO:
      return convertTextTerm(term, "header", ["to"]);
    case ATTR.CC:
      return convertTextTerm(term, "header", ["cc"]);
    case ATTR.TO_OR_CC:
      return convertTextTerm(term, "header", ["to", "cc"]);
    case ATTR.ALL_ADDRESSES:
      return convertTextTerm(term, "header", ["from", "to", "cc", "bcc", "reply-to"]);
    case ATTR.OTHER_HEADER:
    default:
      if (term.attrib >= ATTR.OTHER_HEADER && term.arbitraryHeader)
        return convertTextTerm(term, "header", [term.arbitraryHeader]);
      break;
  }

  if (term.attrib === ATTR.SIZE) {
    const size = Number(getTermValue(term));
    if (!Number.isFinite(size) || size < 0)
      return { supported: false, test: "false", warning: "The message size is invalid." };
    if (term.op === OP.IS_GREATER_THAN)
      return { supported: true, test: `size :over ${Math.trunc(size)}K`, requirements: [] };
    if (term.op === OP.IS_LESS_THAN)
      return { supported: true, test: `size :under ${Math.trunc(size)}K`, requirements: [] };
  }

  return {
    supported: false,
    test: "false",
    warning: `${ATTRIBUTE_NAMES.get(term.attrib) || `Attribute ${term.attrib}`} has no safe server-side equivalent.`
  };
}

/**
 * Applies one boolean operator in a shunting-yard expression parser.
 *
 * @param {object[]} values
 *   expression nodes.
 * @param {string[]} operators
 *   pending operators.
 */
function applyOperator(values, operators) {
  const operator = operators.pop();
  const right = values.pop() || { type: "test", value: "false" };
  const left = values.pop() || { type: "test", value: "false" };
  const children = [];

  for (const node of [left, right]) {
    if (node.type === operator)
      children.push(...node.children);
    else
      children.push(node);
  }

  values.push({ type: operator, children: children });
}

/**
 * Converts flat Thunderbird term connectors and grouping flags into an AST.
 *
 * @param {object[]} terms
 *   source terms.
 * @param {object[]} conversions
 *   converted tests.
 * @returns {object}
 *   an expression node.
 */
function buildExpression(terms, conversions) {
  if (!terms.length)
    return { type: "test", value: "true" };

  const values = [];
  const operators = [];
  const precedence = { or: 1, and: 2 };

  for (let index = 0; index < terms.length; index++) {
    const term = terms[index];

    if (index) {
      const operator = term.booleanAnd ? "and" : "or";
      while (operators.length
          && operators[operators.length - 1] !== "("
          && precedence[operators[operators.length - 1]] >= precedence[operator])
        applyOperator(values, operators);
      operators.push(operator);
    }

    if (term.beginsGrouping)
      operators.push("(");

    values.push({ type: "test", value: conversions[index].test });

    if (term.endsGrouping) {
      while (operators.length && operators[operators.length - 1] !== "(")
        applyOperator(values, operators);
      if (operators[operators.length - 1] === "(")
        operators.pop();
    }
  }

  while (operators.length) {
    if (operators[operators.length - 1] === "(") {
      operators.pop();
      continue;
    }
    applyOperator(values, operators);
  }

  return values.pop() || { type: "test", value: "false" };
}

/**
 * Renders a Sieve test-expression AST.
 *
 * @param {object} node
 *   expression node.
 * @returns {string}
 *   Sieve test syntax.
 */
function renderExpression(node) {
  if (node.type === "test")
    return node.value;

  const command = node.type === "and" ? "allof" : "anyof";
  return `${command}(${node.children.map((child) => {
    return renderExpression(child);
  }).join(", ")})`;
}

/**
 * Derives a server-side mailbox name from a Thunderbird IMAP folder URI.
 *
 * @param {string} value
 *   target folder URI.
 * @returns {string}
 *   mailbox path or an empty string when it is not an IMAP folder.
 */
function folderUriToMailbox(value) {
  try {
    const uri = new URL(value);
    if (uri.protocol !== "imap:" && uri.protocol !== "imaps:")
      return "";
    return decodeURIComponent(uri.pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

/**
 * Converts one Thunderbird action into Sieve commands.
 *
 * @param {object} action
 *   the source action.
 * @returns {object}
 *   conversion result.
 */
function convertAction(action) {
  switch (action.type) {
    case ACTION.MOVE_TO_FOLDER:
    case ACTION.COPY_TO_FOLDER: {
      const mailbox = folderUriToMailbox(action.targetFolderUri);
      if (!mailbox) {
        return {
          supported: false,
          commands: [],
          warning: `Folder ${action.targetFolderUri || "(empty)"} is not a server-side IMAP mailbox.`
        };
      }

      const copy = action.type === ACTION.COPY_TO_FOLDER ? " :copy" : "";
      const requirements = action.type === ACTION.COPY_TO_FOLDER
        ? ["fileinto", "copy"] : ["fileinto"];
      return {
        supported: true,
        commands: [`fileinto${copy} ${quote(mailbox)};`],
        requirements: requirements
      };
    }
    case ACTION.DELETE:
      return { supported: true, commands: ["discard;"], requirements: [] };
    case ACTION.MARK_READ:
      return { supported: true, commands: [`addflag ${quote("\\Seen")};`], requirements: ["imap4flags"] };
    case ACTION.MARK_FLAGGED:
      return { supported: true, commands: [`addflag ${quote("\\Flagged")};`], requirements: ["imap4flags"] };
    case ACTION.FORWARD:
      if (!action.strValue)
        return { supported: false, commands: [], warning: "The forwarding address is empty." };
      return { supported: true, commands: [`redirect ${quote(action.strValue)};`], requirements: [] };
    case ACTION.STOP_EXECUTION:
      return { supported: true, commands: ["stop;"], requirements: [] };
    case ACTION.ADD_TAG:
      if (!action.strValue)
        return { supported: false, commands: [], warning: "The Thunderbird tag is empty." };
      return { supported: true, commands: [`addflag ${quote(action.strValue)};`], requirements: ["imap4flags"] };
    case ACTION.MARK_UNREAD:
      return { supported: true, commands: [`removeflag ${quote("\\Seen")};`], requirements: ["imap4flags"] };
    default:
      return {
        supported: false,
        commands: [],
        warning: `${ACTION_NAMES.get(action.type) || `Action ${action.type}`} is Thunderbird-local and was not translated.`
      };
  }
}

/**
 * Converts a complete Thunderbird filter into a copyable Sieve stanza.
 *
 * @param {object} filter
 *   serialized Thunderbird filter.
 * @returns {object}
 *   UI and Sieve conversion data.
 */
function convertFilter(filter) {
  const terms = filter.terms || [];
  const actions = filter.actions || [];
  const termResults = terms.map((term) => { return convertTerm(term); });
  const actionResults = actions.map((action) => { return convertAction(action); });
  const warnings = [];
  const requirements = new Set();

  for (const result of [...termResults, ...actionResults]) {
    for (const requirement of result.requirements || [])
      requirements.add(requirement);
    if (result.warning)
      warnings.push(result.warning);
  }

  if (!actions.length)
    warnings.push("The filter has no action.");
  if (filter.unparseable)
    warnings.push("Thunderbird marked this filter as unparseable.");
  if (!(filter.filterType & FILTER_TYPE_INBOX_RULE))
    warnings.push("This filter is not configured as an incoming-mail rule.");
  if (filter.filterType & FILTER_TYPE_POST_PLUGIN)
    warnings.push("This filter normally runs after Thunderbird junk classification, which Sieve cannot reproduce.");
  if (!filter.enabled)
    warnings.push("This Thunderbird filter is disabled.");

  const fullySupported = warnings.length === 0
    && termResults.every((result) => { return result.supported; })
    && actionResults.every((result) => { return result.supported; });
  let expression = renderExpression(buildExpression(terms, termResults));

  if (!fullySupported)
    expression = expression === "true" ? "false" : `allof(false, ${expression})`;

  const id = createFilterId(filter);
  const commands = actionResults.flatMap((result) => { return result.commands || []; });
  if (!commands.length)
    commands.push("# No translatable action");

  const lines = [
    `${MANAGED_BLOCK_BEGIN}${id}`,
    `# Thunderbird filter: ${String(filter.name || "Unnamed filter").replace(/[\r\n]+/g, " ")}`,
    `# thunderbird-filter-id: ${id}`
  ];

  if (requirements.size)
    lines.push(`# Required at script start: require [${Array.from(requirements).sort().map(quote).join(", ")}];`);
  if (!fullySupported)
    lines.push("# REVIEW REQUIRED: guarded with false until the warnings are resolved.");
  for (const warning of warnings)
    lines.push(`# WARNING: ${warning}`);

  lines.push(`if ${expression} {`);
  for (const command of commands)
    lines.push(`  ${command}`);
  lines.push("}");
  lines.push(`${MANAGED_BLOCK_END}${id}`);

  return {
    id: id,
    sourceIndex: filter.index,
    deleteToken: filter.deleteToken || "",
    name: filter.name || "Unnamed filter",
    enabled: !!filter.enabled,
    fullySupported: fullySupported,
    warnings: warnings,
    requirements: Array.from(requirements).sort(),
    sourceConditions: terms.map((term, index) => { return describeTerm(term, index); }),
    sourceActions: actions.map((action) => { return describeAction(action); }),
    sieve: `${lines.join("\n")}\n`
  };
}

/**
 * Creates one complete script from converted filter rows.
 *
 * @param {object[]} conversions
 *   converted filters.
 * @returns {string}
 *   a complete Sieve script with a consolidated require command.
 */
function createCombinedScript(conversions) {
  const requirements = new Set();
  for (const conversion of conversions)
    for (const requirement of conversion.requirements)
      requirements.add(requirement);

  const lines = ["# Generated from Thunderbird message filters."];
  if (requirements.size)
    lines.push(`require [${Array.from(requirements).sort().map(quote).join(", ")}];`);
  lines.push("");
  lines.push(conversions.map((conversion) => {
    return conversion.sieve.replace(/[\r\n]+$/g, "");
  }).join("\n\n"));
  return `${lines.join("\n")}\n`;
}

/**
 * Reads capabilities from actual Sieve require commands. Requirement examples
 * in comments are intentionally ignored.
 *
 * @param {string} script
 *   complete Sieve script.
 * @returns {Set<string>}
 *   capabilities already required by the script.
 */
function getScriptRequirements(script) {
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
 * Adds or replaces one generated rule in an existing Sieve script.
 *
 * @param {string} script
 *   current server script.
 * @param {object} conversion
 *   converted Thunderbird rule.
 * @returns {string}
 *   updated complete server script.
 */
function upsertFilterInScript(script, conversion) {
  let content = String(script || "");
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const begin = `${MANAGED_BLOCK_BEGIN}${conversion.id}`;
  const end = `${MANAGED_BLOCK_END}${conversion.id}`;
  const marker = `# thunderbird-filter-id: ${conversion.id}`;
  const beginIndex = content.indexOf(begin);
  const endIndex = content.indexOf(end, Math.max(0, beginIndex));
  const normalizedBlock = conversion.sieve
    .replace(/\r?\n/g, lineEnding)
    .replace(/[\r\n]+$/g, "");

  if (beginIndex !== -1) {
    if (endIndex === -1
        || content.indexOf(begin, beginIndex + begin.length) !== -1
        || content.indexOf(end, endIndex + end.length) !== -1) {
      throw new Error("The managed Thunderbird block is incomplete or duplicated.");
    }

    content = content.slice(0, beginIndex)
      + normalizedBlock
      + content.slice(endIndex + end.length);
  } else {
    if (content.includes(marker)) {
      throw new Error(
        "This script contains an older unbounded Thunderbird block. Replace it manually once before direct updates.");
    }

    if (content && !content.endsWith("\n") && !content.endsWith("\r"))
      content += lineEnding;
    if (content.trim())
      content += lineEnding;
    content += `${normalizedBlock}${lineEnding}`;
  }

  const existing = getScriptRequirements(content);
  const missing = conversion.requirements
    .filter((requirement) => { return !existing.has(requirement); })
    .sort();

  if (missing.length) {
    const requirement = `require [${missing.map(quote).join(", ")}];${lineEnding}`;
    if (content.charCodeAt(0) === 0xFEFF)
      content = content[0] + requirement + content.slice(1);
    else
      content = requirement + content;
  }

  return content;
}

/**
 * Finds the server scripts which contain a generated filter marker.
 *
 * @param {object} conversion
 *   converted filter.
 * @param {object[]} scripts
 *   server scripts with name and content.
 * @returns {string[]}
 *   matching script names.
 */
function findImplementations(conversion, scripts) {
  const marker = `# thunderbird-filter-id: ${conversion.id}`;
  return (scripts || [])
    .filter((script) => { return String(script.content || "").includes(marker); })
    .map((script) => { return script.name; });
}

export {
  convertFilter,
  createCombinedScript,
  createFilterId,
  findImplementations,
  folderUriToMailbox,
  upsertFilterInScript
};
