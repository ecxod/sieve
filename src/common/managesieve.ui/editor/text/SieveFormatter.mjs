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
 * Checks whether a token is a comment.
 *
 * @param {{ type: string, value: string }} token
 *   the token to check.
 * @returns {boolean}
 *   true when the token contains a comment.
 */
function isComment(token) {
  return token?.type === "line-comment" || token?.type === "block-comment";
}

/**
 * Finds the next token which is not a comment.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @param {int} start
 *   the offset at which to start looking.
 * @returns {{ type: string, value: string }|null}
 *   the next structural token, or null at the end of the script.
 */
function nextStructuralToken(tokens, start) {
  while (isComment(tokens[start]))
    start++;

  return tokens[start] ?? null;
}

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
  let lineBreakBefore = false;

  const addToken = (type, value) => {
    tokens.push({ type, value, lineBreakBefore });
    lineBreakBefore = false;
  };

  while (offset < script.length) {
    const character = script[offset];

    if (/\s/.test(character)) {
      if (character === "\n" || character === "\r")
        lineBreakBefore = true;
      offset++;
      continue;
    }

    if (character === "#") {
      let end = script.indexOf("\n", offset);

      if (end === -1)
        end = script.length;

      addToken("line-comment", script.slice(offset, end));
      offset = end;
      continue;
    }

    if (script.startsWith("/*", offset)) {
      let end = script.indexOf("*/", offset + 2);

      end = (end === -1) ? script.length : end + 2;
      addToken("block-comment", script.slice(offset, end));
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

      addToken("value", script.slice(offset, end));
      offset = end;
      continue;
    }

    if (script.slice(offset, offset + "text:".length).toLowerCase() === "text:") {
      const multiline = readMultilineString(script, offset);

      addToken("multiline", multiline.value);
      offset = multiline.end;
      continue;
    }

    if (SYMBOLS.has(character)) {
      addToken("symbol", character);
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

    addToken("value", script.slice(offset, end));
    offset = end;
  }

  return tokens;
}

/**
 * Reads one leading Sieve require command.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @param {int} start
 *   offset of the require keyword.
 * @returns {{ end: int, requirements: Array, comments: Array }|null}
 *   parsed command, or null when it is malformed.
 */
function readRequireCommand(tokens, start) {
  if (tokens[start]?.type !== "value"
    || tokens[start].value.toLowerCase() !== "require")
    return null;

  const requirements = [];
  const comments = [];
  let cursor = start + 1;

  while (isComment(tokens[cursor]))
    comments.push(tokens[cursor++]);

  if (tokens[cursor]?.type === "symbol" && tokens[cursor].value === "[") {
    cursor++;
    let expectValue = true;

    while (tokens[cursor]
      && !(tokens[cursor].type === "symbol" && tokens[cursor].value === "]")) {
      if (isComment(tokens[cursor])) {
        comments.push(tokens[cursor++]);
        continue;
      }

      if (expectValue
        && tokens[cursor].type === "value"
        && tokens[cursor].value.startsWith("\"")) {
        requirements.push(tokens[cursor]);
        expectValue = false;
        cursor++;
        continue;
      }

      if (!expectValue
        && tokens[cursor].type === "symbol"
        && tokens[cursor].value === ",") {
        expectValue = true;
        cursor++;
        continue;
      }

      return null;
    }

    if (!tokens[cursor] || requirements.length === 0 || expectValue)
      return null;

    cursor++;
  } else if (tokens[cursor]?.type === "value"
    && tokens[cursor].value.startsWith("\"")) {
    requirements.push(tokens[cursor++]);
  } else {
    return null;
  }

  while (isComment(tokens[cursor]))
    comments.push(tokens[cursor++]);

  if (tokens[cursor]?.type !== "symbol" || tokens[cursor].value !== ";")
    return null;

  return { end: cursor, requirements, comments };
}

/**
 * Combines consecutive require commands at the start of a script.
 *
 * Leading and inter-command comments are retained. If the require section is
 * malformed, or contains fewer than two commands, the original tokens are
 * returned unchanged.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @returns {Array<{ type: string, value: string }>}
 *   tokens with a single require string list when possible.
 */
function combineRequireCommands(tokens) {
  const leadingComments = [];
  const retainedComments = [];
  const requirements = [];
  let commands = 0;
  let offset = 0;

  while (isComment(tokens[offset]))
    leadingComments.push(tokens[offset++]);

  while (tokens[offset]?.type === "value"
    && tokens[offset].value.toLowerCase() === "require") {
    const command = readRequireCommand(tokens, offset);

    if (command === null)
      return tokens;

    requirements.push(...command.requirements);
    retainedComments.push(...command.comments);
    commands++;
    offset = command.end + 1;

    while (isComment(tokens[offset]))
      retainedComments.push(tokens[offset++]);
  }

  if (commands < 2)
    return tokens;

  const combined = [
    { type: "value", value: "require" },
    { type: "symbol", value: "[" }
  ];

  requirements.forEach((requirement, index) => {
    if (index)
      combined.push({ type: "symbol", value: "," });

    combined.push(requirement);
  });

  combined.push(
    { type: "symbol", value: "]" },
    { type: "symbol", value: ";" }
  );

  return [
    ...leadingComments,
    ...combined,
    ...retainedComments,
    ...tokens.slice(offset)
  ];
}

/**
 * Finds the semicolon ending a simple action command.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @param {int} start
 *   first token after the command keyword.
 * @returns {int}
 *   semicolon offset, or -1 when the command is malformed.
 */
function findSimpleCommandEnd(tokens, start) {
  const delimiters = [];

  for (let index = start; index < tokens.length; index++) {
    const token = tokens[index];

    if (token.type !== "symbol")
      continue;

    if (token.value === "[" || token.value === "(") {
      delimiters.push(token.value === "[" ? "]" : ")");
      continue;
    }

    if (token.value === "]" || token.value === ")") {
      if (delimiters.pop() !== token.value)
        return -1;

      continue;
    }

    if (delimiters.length)
      continue;

    if (token.value === ";")
      return index;

    if (token.value === "{" || token.value === "}")
      return -1;
  }

  return -1;
}

/**
 * Checks whether a token starts a new Sieve statement.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @param {int} index
 *   token offset.
 * @returns {boolean}
 *   true when the token can be a command keyword.
 */
function isStatementStart(tokens, index) {
  let previous = index - 1;

  while (isComment(tokens[previous]))
    previous--;

  if (previous < 0)
    return true;

  return tokens[previous].type === "symbol"
    && [";", "{", "}"].includes(tokens[previous].value);
}

/**
 * Adds :create to complete fileinto actions which do not already use it.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @returns {{ tokens: Array, usesCreate: boolean }}
 *   transformed tokens and whether a valid fileinto action was found.
 */
function addCreateToFileintoCommands(tokens) {
  const transformed = [];
  let usesCreate = false;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (token.type !== "value"
      || token.value.toLowerCase() !== "fileinto"
      || !isStatementStart(tokens, index)) {
      transformed.push(token);
      continue;
    }

    const end = findSimpleCommandEnd(tokens, index + 1);

    if (end === -1) {
      transformed.push(token);
      continue;
    }

    let target = end - 1;

    while (target > index && isComment(tokens[target]))
      target--;

    const hasMailboxTarget = tokens[target]?.type === "multiline"
      || (tokens[target]?.type === "value"
        && tokens[target].value.startsWith("\""));

    if (!hasMailboxTarget) {
      transformed.push(token);
      continue;
    }

    const hasCreate = tokens.slice(index + 1, end).some((item) => {
      return item.type === "value" && item.value.toLowerCase() === ":create";
    });

    transformed.push(...tokens.slice(index, target));

    if (!hasCreate)
      transformed.push({ type: "value", value: ":create" });

    transformed.push(...tokens.slice(target, end + 1));

    usesCreate = true;
    index = end;
  }

  return { tokens: transformed, usesCreate };
}

/**
 * Decodes a quoted Sieve string used as a fileinto destination.
 *
 * @param {string} value
 *   quoted Sieve string.
 * @returns {string}
 *   decoded string value.
 */
function decodeQuotedString(value) {
  return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
}

/**
 * Finds complete fileinto actions without interpreting comments or strings.
 *
 * Multiline and computed destinations are reported as unverifiable instead of
 * guessing a mailbox name. This is shared by the Inbox rule helper so its
 * mailbox warning follows the same token boundaries as the formatter.
 *
 * @param {string} script
 *   Sieve source or rule snippet.
 * @returns {Array<{ mailbox: string|null, tags: string[] }>}
 *   discovered fileinto actions.
 */
function inspectFileintoActions(script) {
  const tokens = tokenize(`${script || ""}`.replace(/\r\n?/g, "\n"));
  const actions = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (token.type !== "value"
      || token.value.toLowerCase() !== "fileinto"
      || !isStatementStart(tokens, index))
      continue;

    const end = findSimpleCommandEnd(tokens, index + 1);
    if (end === -1)
      continue;

    let target = end - 1;
    while (target > index && isComment(tokens[target]))
      target--;

    const targetToken = tokens[target];
    const mailbox = targetToken?.type === "value"
      && targetToken.value.startsWith("\"")
      ? decodeQuotedString(targetToken.value) : null;
    const tags = tokens.slice(index + 1, target)
      .filter((item) => {
        return item.type === "value" && item.value.startsWith(":");
      })
      .map((item) => { return item.value.toLowerCase(); });

    actions.push({ mailbox, tags });
    index = end;
  }

  return actions;
}

/**
 * Adds a missing capability to the leading require section.
 *
 * The new command is inserted directly after the last valid require command,
 * before comments belonging to the first executable statement. A malformed
 * leading require section is left untouched.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @param {string} requirement
 *   capability name without quotes.
 * @returns {Array|null}
 *   updated tokens, or null when the leading require section is malformed.
 */
function ensureRequirement(tokens, requirement) {
  let offset = 0;
  let lastRequireEnd = -1;
  let found = false;

  while (isComment(tokens[offset]))
    offset++;

  let cursor = offset;

  while (tokens[cursor]?.type === "value"
    && tokens[cursor].value.toLowerCase() === "require") {
    const command = readRequireCommand(tokens, cursor);

    if (command === null)
      return null;

    found ||= command.requirements.some((item) => {
      return item.value.slice(1, -1) === requirement;
    });
    lastRequireEnd = command.end;
    cursor = command.end + 1;

    while (isComment(tokens[cursor]))
      cursor++;
  }

  if (found)
    return tokens;

  const insertion = lastRequireEnd === -1 ? offset : lastRequireEnd + 1;
  const command = [
    { type: "value", value: "require" },
    { type: "value", value: `"${requirement}"` },
    { type: "symbol", value: ";" }
  ];

  return [
    ...tokens.slice(0, insertion),
    ...command,
    ...tokens.slice(insertion)
  ];
}

/**
 * Finds the closing brace for a Sieve block.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @param {int} start
 *   the opening brace offset.
 * @returns {int}
 *   the closing brace offset, or -1 for an incomplete block.
 */
function findBlockEnd(tokens, start) {
  let depth = 0;

  for (let index = start; index < tokens.length; index++) {
    if (tokens[index].type !== "symbol")
      continue;

    if (tokens[index].value === "{")
      depth++;
    else if (tokens[index].value === "}")
      depth--;

    if (depth === 0)
      return index;
  }

  return -1;
}

/**
 * Reads one if/elsif/else chain without splitting its branches.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @param {int} start
 *   the offset of the if keyword.
 * @returns {{ start: int, end: int }|null}
 *   the complete chain, or null for malformed input.
 */
function readIfChain(tokens, start) {
  if (tokens[start]?.type !== "value"
    || tokens[start].value.toLowerCase() !== "if")
    return null;

  let branchStart = start;
  let chainEnd = -1;

  while (branchStart < tokens.length) {
    let openingBrace = branchStart + 1;

    while (openingBrace < tokens.length
      && !(tokens[openingBrace].type === "symbol"
        && tokens[openingBrace].value === "{"))
      openingBrace++;

    if (openingBrace === tokens.length)
      return null;

    chainEnd = findBlockEnd(tokens, openingBrace);

    if (chainEnd === -1)
      return null;

    let cursor = chainEnd + 1;

    while (isComment(tokens[cursor]))
      cursor++;

    const keyword = tokens[cursor]?.type === "value"
      ? tokens[cursor].value.toLowerCase()
      : null;

    if (keyword !== "elsif" && keyword !== "else")
      break;

    branchStart = cursor;
  }

  return { start, end: chainEnd };
}

/**
 * Gets the single unambiguous fileinto target used by an if chain.
 *
 * Chains without a quoted target, or with several different targets, are not
 * sortable. This avoids guessing which branch should determine the position.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @param {int} start
 *   the first token in the chain.
 * @param {int} end
 *   the final token in the chain.
 * @returns {string|null}
 *   the normalized fileinto target, or null when it is ambiguous.
 */
function getFileintoSortKey(tokens, start, end) {
  const targets = new Set();

  for (let index = start; index <= end; index++) {
    if (tokens[index].type !== "value"
      || tokens[index].value.toLowerCase() !== "fileinto")
      continue;

    let target = null;

    for (let cursor = index + 1; cursor <= end; cursor++) {
      if (tokens[cursor].type === "symbol" && tokens[cursor].value === ";")
        break;

      if (tokens[cursor].type !== "value"
        || !tokens[cursor].value.startsWith("\""))
        continue;

      target = tokens[cursor].value
        .slice(1, -1)
        .replace(/\\(["\\])/g, "$1")
        .toLowerCase();
    }

    if (target !== null)
      targets.add(target);
  }

  return targets.size === 1 ? [...targets][0] : null;
}

/**
 * Reads a sortable top-level if chain, including its leading comments.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @param {int} start
 *   the possible start of a chain or its leading comments.
 * @returns {{ start: int, end: int, key: string }|null}
 *   the sortable item, or null when no unambiguous chain starts here.
 */
function readSortableIfChain(tokens, start) {
  let ifStart = start;

  while (isComment(tokens[ifStart])) {
    if (ifStart === start && start !== 0 && !tokens[ifStart].lineBreakBefore)
      return null;

    ifStart++;
  }

  const chain = readIfChain(tokens, ifStart);

  if (chain === null)
    return null;

  const key = getFileintoSortKey(tokens, chain.start, chain.end);

  if (key === null)
    return null;

  return { start, end: chain.end, key };
}

/**
 * Sorts consecutive, independent top-level if chains by fileinto target.
 *
 * Each complete if/elsif/else chain and its leading comments move as one unit.
 * Non-if statements and ambiguous chains form boundaries which are never
 * crossed.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @returns {Array<{ type: string, value: string }>}
 *   tokens with sortable top-level runs ordered by target folder.
 */
function sortIfChainsByFileinto(tokens) {
  const sorted = [];
  let blockDepth = 0;
  let index = 0;

  while (index < tokens.length) {
    const item = blockDepth === 0
      ? readSortableIfChain(tokens, index)
      : null;

    if (item !== null) {
      const run = [item];
      let cursor = item.end + 1;

      while (cursor < tokens.length) {
        const next = readSortableIfChain(tokens, cursor);

        if (next === null)
          break;

        run.push(next);
        cursor = next.end + 1;
      }

      run
        .map((entry, order) => {
          return { ...entry, order };
        })
        .sort((left, right) => {
          if (left.key < right.key)
            return -1;
          if (left.key > right.key)
            return 1;
          return left.order - right.order;
        })
        .forEach((entry) => {
          sorted.push(...tokens.slice(entry.start, entry.end + 1));
        });

      index = cursor;
      continue;
    }

    const token = tokens[index++];
    sorted.push(token);

    if (token.type !== "symbol")
      continue;

    if (token.value === "{")
      blockDepth++;
    else if (token.value === "}")
      blockDepth = Math.max(0, blockDepth - 1);
  }

  return sorted;
}

/**
 * Creates a stable comparison value for a non-comment Sieve token.
 *
 * Sieve identifiers are case-insensitive, while quoted and multiline strings
 * retain their exact value.
 *
 * @param {{ type: string, value: string }} token
 *   the token to normalize.
 * @returns {string}
 *   a comparison-safe token signature.
 */
function getStructuralTokenSignature(token) {
  let value = token.value;

  if (token.type === "value" && !value.startsWith("\""))
    value = value.toLowerCase();

  return `${token.type}:${value.length}:${value}`;
}

/**
 * Describes an action body which can safely be shared by an anyof rule.
 *
 * Comments do not affect action equality. They are retained in slots between
 * the surrounding structural tokens so combining blocks never discards them.
 * A final stop command guarantees that the original sibling if statements
 * could execute the common action body at most once.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @param {int} start
 *   the first token inside the action block.
 * @param {int} end
 *   the token after the action block.
 * @returns {{ structural: Array, comments: Array, signature: string }|null}
 *   the mergeable body description, or null when no terminal stop exists.
 */
function readMergeableActionBody(tokens, start, end) {
  const structural = [];
  const comments = [[]];

  for (let index = start; index < end; index++) {
    if (isComment(tokens[index])) {
      comments[structural.length].push(tokens[index]);
      continue;
    }

    structural.push(tokens[index]);
    comments.push([]);
  }

  const stop = structural[structural.length - 2];
  const semicolon = structural[structural.length - 1];

  if (stop?.type !== "value"
    || stop.value.toLowerCase() !== "stop"
    || semicolon?.type !== "symbol"
    || semicolon.value !== ";")
    return null;

  return {
    structural,
    comments,
    signature: structural.map(getStructuralTokenSignature).join("|")
  };
}

/**
 * Reads a standalone if statement which is eligible for anyof combining.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @param {int} start
 *   the possible start of leading comments or an if statement.
 * @param {int} limit
 *   the token after the current sibling scope.
 * @returns {object|null}
 *   the mergeable statement description, or null when it is not eligible.
 */
function readMergeableIf(tokens, start, limit) {
  let ifStart = start;

  while (ifStart < limit && isComment(tokens[ifStart]))
    ifStart++;

  if (tokens[ifStart]?.type !== "value"
    || tokens[ifStart].value.toLowerCase() !== "if")
    return null;

  let openingBrace = ifStart + 1;

  while (openingBrace < limit
    && !(tokens[openingBrace].type === "symbol"
      && tokens[openingBrace].value === "{"))
    openingBrace++;

  if (openingBrace === limit)
    return null;

  const closingBrace = findBlockEnd(tokens, openingBrace);

  if (closingBrace === -1 || closingBrace >= limit)
    return null;

  let afterStatement = closingBrace + 1;

  while (afterStatement < limit && isComment(tokens[afterStatement]))
    afterStatement++;

  const branch = tokens[afterStatement]?.type === "value"
    ? tokens[afterStatement].value.toLowerCase()
    : null;

  if (branch === "elsif" || branch === "else")
    return null;

  const condition = tokens.slice(ifStart + 1, openingBrace);

  if (!condition.some((token) => { return !isComment(token); }))
    return null;

  const body = readMergeableActionBody(tokens, openingBrace + 1, closingBrace);

  if (body === null)
    return null;

  return {
    start,
    end: closingBrace,
    ifToken: tokens[ifStart],
    openingBraceToken: tokens[openingBrace],
    closingBraceToken: tokens[closingBrace],
    leadingComments: tokens.slice(start, ifStart),
    condition,
    body
  };
}

/**
 * Combines the comments and one structural copy of identical action bodies.
 *
 * @param {object[]} statements
 *   the if statements being combined.
 * @returns {Array<{ type: string, value: string }>}
 *   one shared action body without comment loss.
 */
function combineActionBodies(statements) {
  const combined = [];
  const structural = statements[0].body.structural;

  for (let index = 0; index <= structural.length; index++) {
    statements.forEach((statement) => {
      combined.push(...statement.body.comments[index]);
    });

    if (index < structural.length)
      combined.push(structural[index]);
  }

  return combined;
}

/**
 * Combines adjacent standalone sibling if statements with identical, terminal
 * action bodies into one anyof statement. Every brace scope is processed
 * independently, so executable statements and nesting boundaries are never
 * crossed.
 *
 * @param {Array<{ type: string, value: string }>} tokens
 *   the tokenized Sieve source.
 * @returns {Array<{ type: string, value: string }>}
 *   tokens with safe sibling runs combined.
 */
function combineIfBlocksWithAnyof(tokens) {
  const createToken = (type, value) => {
    return { type, value, lineBreakBefore: false };
  };

  const transformScope = (source, start, end) => {
    const transformed = [];
    let index = start;

    while (index < end) {
      const first = readMergeableIf(source, index, end);

      if (first !== null) {
        const statements = [first];
        let cursor = first.end + 1;

        while (cursor < end) {
          const next = readMergeableIf(source, cursor, end);

          if (next === null || next.body.signature !== first.body.signature)
            break;

          statements.push(next);
          cursor = next.end + 1;
        }

        if (statements.length > 1) {
          transformed.push(
            first.ifToken,
            createToken("value", "anyof"),
            createToken("symbol", "(")
          );

          statements.forEach((statement, statementIndex) => {
            transformed.push(...statement.leadingComments, ...statement.condition);

            if (statementIndex + 1 < statements.length)
              transformed.push(createToken("symbol", ","));
          });

          const body = combineActionBodies(statements);

          transformed.push(
            createToken("symbol", ")"),
            first.openingBraceToken,
            ...transformScope(body, 0, body.length),
            first.closingBraceToken
          );

          index = cursor;
          continue;
        }
      }

      const token = source[index];

      if (token.type === "symbol" && token.value === "{") {
        const blockEnd = findBlockEnd(source, index);

        if (blockEnd !== -1 && blockEnd < end) {
          transformed.push(
            token,
            ...transformScope(source, index + 1, blockEnd),
            source[blockEnd]
          );
          index = blockEnd + 1;
          continue;
        }
      }

      transformed.push(token);
      index++;
    }

    return transformed;
  };

  return transformScope(tokens, 0, tokens.length);
}

/**
 * Formats Sieve source with configurable indentation and structural line breaks.
 *
 * Quoted strings, multiline strings and comments are treated as opaque so
 * their contents are not changed.
 *
 * @param {string} script
 *   the Sieve source.
 * @param {object} [options]
 *   the formatting preferences.
 * @param {boolean} [options.indentWithTabs=true]
 *   use tabs instead of spaces for indentation.
 * @param {int} [options.indentWidth=2]
 *   number of spaces per indentation level.
 * @param {boolean} [options.multilineLists=true]
 *   put list values on separate lines.
 * @param {boolean} [options.multilineTests=true]
 *   put test arguments on separate lines.
 * @param {boolean} [options.ignoreCompactLineBreaks=false]
 *   discard source line breaks after commas in compact lists and tests.
 * @param {boolean} [options.braceOnNewLine=false]
 *   put opening block braces on a separate line.
 * @param {boolean} [options.combineRequires=false]
 *   combine consecutive require commands into one string list.
 * @param {boolean} [options.blankLineAfterRequires=false]
 *   add a blank line after the leading require section.
 * @param {boolean} [options.blankLineAfterIf=false]
 *   add a blank line after complete if/elsif/else chains.
 * @param {boolean} [options.sortIfByFileinto=false]
 *   sort consecutive top-level if chains by their unambiguous fileinto target.
 * @param {boolean} [options.combineIfWithAnyof=false]
 *   combine safe sibling if statements with identical terminal action bodies.
 * @param {boolean} [options.ensureFileintoCreate=false]
 *   add :create to fileinto actions and require the mailbox capability.
 * @returns {string}
 *   the formatted source using LF line endings for CodeMirror.
 */
function formatSieveScript(script, options = {}) {
  script = script.replace(/\r\n|\r/g, "\n");

  if (script.trim() === "")
    return "";

  const indentWithTabs = options.indentWithTabs !== false;
  const parsedIndentWidth = Number.parseInt(options.indentWidth, 10);
  const indentWidth = Number.isNaN(parsedIndentWidth)
    ? 2
    : Math.max(0, Math.min(8, parsedIndentWidth));
  const indentUnit = indentWithTabs ? "\t" : " ".repeat(indentWidth);
  const multilineLists = options.multilineLists !== false;
  const multilineTests = options.multilineTests !== false;
  const ignoreCompactLineBreaks = options.ignoreCompactLineBreaks === true;
  const braceOnNewLine = options.braceOnNewLine === true;
  const combineRequires = options.combineRequires === true;
  const blankLineAfterRequires = options.blankLineAfterRequires === true;
  const blankLineAfterIf = options.blankLineAfterIf === true;
  const sortIfByFileinto = options.sortIfByFileinto === true;
  const combineIfWithAnyof = options.combineIfWithAnyof === true;
  const ensureFileintoCreate = options.ensureFileintoCreate === true;

  let tokens = tokenize(script);

  if (ensureFileintoCreate) {
    const transformed = addCreateToFileintoCommands(tokens);

    if (transformed.usesCreate) {
      const withRequirement = ensureRequirement(transformed.tokens, "mailbox");

      if (withRequirement !== null)
        tokens = withRequirement;
    }
  }

  if (combineRequires)
    tokens = combineRequireCommands(tokens);
  if (sortIfByFileinto)
    tokens = sortIfChainsByFileinto(tokens);
  if (combineIfWithAnyof)
    tokens = combineIfBlocksWithAnyof(tokens);
  const lines = [];
  let current = "";
  let blockIndentation = 0;
  let continuationIndentation = 0;
  let statementKeyword = null;
  const delimiters = [];
  const blocks = [];

  const indentation = () => {
    return blockIndentation + continuationIndentation;
  };

  const startLine = () => {
    if (current === "")
      current = indentUnit.repeat(indentation());
  };

  const finishLine = () => {
    if (current.trim() !== "")
      lines.push(current.trimEnd());

    current = "";
  };

  const addBlankLine = () => {
    finishLine();

    if (lines.length && lines[lines.length - 1] !== "")
      lines.push("");
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

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

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
      if (statementKeyword === null)
        statementKeyword = token.value.toLowerCase();

      append(token.value);
      continue;
    }

    if (token.value === "{") {
      if (braceOnNewLine && current.trim() !== "")
        finishLine();

      append("{", !braceOnNewLine);
      finishLine();
      blocks.push(statementKeyword);
      statementKeyword = null;
      blockIndentation++;
      continue;
    }

    if (token.value === "}") {
      finishLine();
      blockIndentation = Math.max(0, blockIndentation - 1);
      append("}", false);
      finishLine();

      const blockKeyword = blocks.length ? blocks.pop() : null;
      const next = nextStructuralToken(tokens, index + 1);
      const continuesIf = next?.type === "value"
        && ["elsif", "else"].includes(next.value.toLowerCase());
      const closesParentBlock = next?.type === "symbol" && next.value === "}";

      statementKeyword = null;

      if (blankLineAfterIf
        && ["if", "elsif", "else"].includes(blockKeyword)
        && next !== null
        && !continuesIf
        && !closesParentBlock)
        addBlankLine();

      continue;
    }

    if (token.value === ";") {
      append(";", false);
      finishLine();

      const next = nextStructuralToken(tokens, index + 1);
      const nextIsRequire = next?.type === "value"
        && next.value.toLowerCase() === "require";

      if (blankLineAfterRequires
        && statementKeyword === "require"
        && tokens[index + 1] !== undefined
        && !nextIsRequire)
        addBlankLine();

      statementKeyword = null;
      continue;
    }

    if (token.value === ",") {
      append(",", false);

      if (delimiters.length && delimiters[delimiters.length - 1].multiline)
        finishLine();
      else if (!ignoreCompactLineBreaks && tokens[index + 1]?.lineBreakBefore)
        finishLine();
      else
        current += " ";

      continue;
    }

    if (token.value === "(" || token.value === "[") {
      const closing = token.value === "(" ? ")" : "]";
      const isEmpty = tokens[index + 1]?.type === "symbol"
        && tokens[index + 1].value === closing;
      const multiline = !isEmpty && (token.value === "["
        ? multilineLists
        : multilineTests);

      append(token.value);
      delimiters.push({ closing, multiline });

      if (multiline) {
        finishLine();
        continuationIndentation++;
      }

      continue;
    }

    if (token.value === ")" || token.value === "]") {
      const delimiter = delimiters.length
        ? delimiters.pop()
        : { multiline: false };

      if (delimiter.multiline) {
        finishLine();
        continuationIndentation = Math.max(0, continuationIndentation - 1);
      }

      current = current.trimEnd();
      append(token.value, false);
      continue;
    }

    append(token.value);
  }

  finishLine();

  return `${lines.join("\n")}\n`;
}

export { formatSieveScript, inspectFileintoActions };
