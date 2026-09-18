/*
 * The content of this file is licensed. You may obtain a copy of
 * https://github.com/thsmi/sieve/ or request it via email from the author.
 */

const EXCERPT_CONTEXT = 80;
const NOT_FOUND = -1;

/**
 * Finds text in Sieve scripts and renders safe excerpts.
 */
class SieveScriptSearch {
  /**
   * Searches one script for a token.
   * @param {string} script the script content.
   * @param {string} token the text to find.
   * @param {boolean} [isCaseSensitive] whether casing must match.
   * @returns {object|null} a match summary or null.
   */
  static find(script, token, isCaseSensitive = false) {
    if (typeof (script) !== "string" || typeof (token) !== "string" || token === "")
      return null;

    const haystack = isCaseSensitive ? script : script.toLocaleLowerCase();
    const needle = isCaseSensitive ? token : token.toLocaleLowerCase();
    const index = haystack.indexOf(needle);
    if (index === NOT_FOUND)
      return null;

    let count = 0;
    let offset = index;
    while (offset !== NOT_FOUND) {
      count++;
      offset = haystack.indexOf(needle, offset + needle.length);
    }

    const start = Math.max(0, index - EXCERPT_CONTEXT);
    const end = Math.min(script.length, index + token.length + EXCERPT_CONTEXT);
    return {
      count: count,
      before: `${start > 0 ? "..." : ""}${script.slice(start, index)}`,
      match: script.slice(index, index + token.length),
      after: `${script.slice(index + token.length, end)}${end < script.length ? "..." : ""}`
    };
  }

  /**
   * Renders an excerpt without interpreting script content as HTML.
   * @param {Element} element the target element.
   * @param {object} result the match summary.
   */
  static renderExcerpt(element, result) {
    while (element.firstChild)
      element.firstChild.remove();
    element.append(document.createTextNode(result.before));
    const match = document.createElement("mark");
    match.textContent = result.match;
    element.append(match);
    element.append(document.createTextNode(result.after));
  }
}

export { SieveScriptSearch };
