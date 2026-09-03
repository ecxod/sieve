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

const DEFAULT_TAB_POLICY = true;
const DEFAULT_TAB_WIDTH = 2;
const DEFAULT_INDENTATION_POLICY = false;
const DEFAULT_INDENTATION_WIDTH = 2;
const DEFAULT_FORMAT_LISTS_MULTILINE = true;
const DEFAULT_FORMAT_TESTS_MULTILINE = true;
const DEFAULT_FORMAT_IGNORE_COMPACT_LINE_BREAKS = false;
const DEFAULT_FORMAT_BRACE_NEW_LINE = false;
const DEFAULT_FORMAT_REQUIRES_COMBINED = false;
const DEFAULT_FORMAT_BLANK_LINE_AFTER_REQUIRES = false;
const DEFAULT_FORMAT_BLANK_LINE_AFTER_IF = false;
const DEFAULT_FORMAT_SORT_IF_BY_FILEINTO = false;
const DEFAULT_FORMAT_COMBINE_IF_WITH_ANYOF = false;
const DEFAULT_FORMAT_FILEINTO_CREATE = false;

/**
 * Manages the sieve editor settings.
 */
class SieveEditorSettings {

  /**
   * Create a new instance.
   *
   * @param {SievePrefManager} pref
   *   the pref manager to be used for this editor settings.
   */
  constructor(pref) {
    this.pref = pref;
  }

  /**
   * Sets an editor setting.
   *
   * @param {string} name
   *   the preference name
   * @param {object} value
   *   the preference value
   */
  async setValue(name, value) {
    await this.pref.setValue(`editor.${name}`, value);
  }

  /**
   * Gets an editor settings.
   *
   * @param {string} name
   *   the preference name
   * @returns {object}
   *   the editor settings value.
   */
  async getValue(name) {

    if (name === "tabulator-policy")
      return await this.pref.getBoolean("editor.tabulator-policy", DEFAULT_TAB_POLICY);

    if (name === "tabulator-width")
      return await this.pref.getInteger("editor.tabulator-width", DEFAULT_TAB_WIDTH);

    if (name === "indentation-policy")
      return await this.pref.getBoolean("editor.indentation-policy", DEFAULT_INDENTATION_POLICY);

    if (name === "indentation-width")
      return await this.pref.getInteger("editor.indentation-width", DEFAULT_INDENTATION_WIDTH);

    if (name === "format-lists-multiline")
      return await this.pref.getBoolean(
        "editor.format-lists-multiline", DEFAULT_FORMAT_LISTS_MULTILINE);

    if (name === "format-tests-multiline")
      return await this.pref.getBoolean(
        "editor.format-tests-multiline", DEFAULT_FORMAT_TESTS_MULTILINE);

    if (name === "format-compact-ignore-line-breaks")
      return await this.pref.getBoolean(
        "editor.format-compact-ignore-line-breaks",
        DEFAULT_FORMAT_IGNORE_COMPACT_LINE_BREAKS);

    if (name === "format-brace-new-line")
      return await this.pref.getBoolean(
        "editor.format-brace-new-line", DEFAULT_FORMAT_BRACE_NEW_LINE);

    if (name === "format-requires-combined")
      return await this.pref.getBoolean(
        "editor.format-requires-combined", DEFAULT_FORMAT_REQUIRES_COMBINED);

    if (name === "format-blank-line-after-requires")
      return await this.pref.getBoolean(
        "editor.format-blank-line-after-requires", DEFAULT_FORMAT_BLANK_LINE_AFTER_REQUIRES);

    if (name === "format-blank-line-after-if")
      return await this.pref.getBoolean(
        "editor.format-blank-line-after-if", DEFAULT_FORMAT_BLANK_LINE_AFTER_IF);

    if (name === "format-sort-if-by-fileinto")
      return await this.pref.getBoolean(
        "editor.format-sort-if-by-fileinto", DEFAULT_FORMAT_SORT_IF_BY_FILEINTO);

    if (name === "format-combine-if-with-anyof")
      return await this.pref.getBoolean(
        "editor.format-combine-if-with-anyof", DEFAULT_FORMAT_COMBINE_IF_WITH_ANYOF);

    if (name === "format-fileinto-create")
      return await this.pref.getBoolean(
        "editor.format-fileinto-create", DEFAULT_FORMAT_FILEINTO_CREATE);

    throw new Error(`Unknown settings ${name}`);
  }
}

export { SieveEditorSettings };
