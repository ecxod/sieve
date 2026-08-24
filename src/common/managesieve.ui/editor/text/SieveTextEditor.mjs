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

/* global CodeMirror */

import { SieveTemplate } from "./../../utils/SieveTemplate.mjs";
import { SieveTheme } from "./../../utils/SieveTheme.mjs";
import { SieveAbstractEditorUI } from "./../SieveAbstractEditor.mjs";
import { formatSieveScript } from "./SieveFormatter.mjs";

const EDITOR_SCROLL_INTO_VIEW_OFFSET = 200;

/**
 * An text editor ui for sieve scripts.
 */
class SieveTextEditorUI extends SieveAbstractEditorUI {

  /**
   * Creates a new text editor UI.
   *
   * @param {SieveEditorController} controller
   *   The controller which is assigned to this editor.
   * @param {string} [id]
   *   An optional id, which points to a the textbox, which will be converted
   *   into a code mirror input. In case it is omitted the id "code" will be used.
   */
  constructor(controller, id) {

    super(controller);

    if (typeof (id) === "undefined" || id === null)
      this.id = "code";

    this.cm = null;

    this.activeLine = null;

    this.changed = false;

    this.formatMultilineLists = true;
    this.formatMultilineTests = true;
    this.formatBraceOnNewLine = false;

    window.addEventListener("sieve-theme-changed", () => {
      if (this.cm)
        this.cm.setOption("theme", SieveTheme.getCodeMirrorTheme());
    });
  }

  /**
   * Renders the text editors settings
   */
  async renderSettings() {


    const loader = new SieveTemplate();

    // Indentation
    document
      .querySelector("#sieve-content-settings")
      .append(await loader.load("./editor/text/editor.settings.indentation.html"));

    // Indentation width...
    document
      .querySelector("#editor-settings-indentation-width")
      .addEventListener("change", async () => {
        await this.setIndentWidth(
          document.querySelector("#editor-settings-indentation-width").value);
      });

    document.querySelector("#editor-settings-indentation-width")
      .value = this.getIndentWidth();

    // Indentation policy...
    document
      .querySelector("#editor-settings-indentation-policy-spaces")
      .addEventListener("change", async () => { await this.setIndentWithTabs(false); });

    document
      .querySelector("#editor-settings-indentation-policy-tabs")
      .addEventListener("change", async () => { await this.setIndentWithTabs(true); });

    if (this.getIndentWithTabs())
      document.querySelector("#editor-settings-indentation-policy-tabs").checked = true;
    else
      document.querySelector("#editor-settings-indentation-policy-spaces").checked = true;

    // Tabulator width...
    document
      .querySelector("#editor-settings-tabulator-width")
      .addEventListener("change", async () => {
        await this.setTabWidth(
          document.querySelector("#editor-settings-tabulator-width").value);
      });

    document.querySelector("#editor-settings-tabulator-width")
      .value = this.getTabWidth();

    // Formatter list layout...
    document
      .querySelector("#editor-settings-format-lists-compact")
      .addEventListener("change", async () => { await this.setFormatMultilineLists(false); });

    document
      .querySelector("#editor-settings-format-lists-multiline")
      .addEventListener("change", async () => { await this.setFormatMultilineLists(true); });

    document
      .querySelector(this.getFormatMultilineLists()
        ? "#editor-settings-format-lists-multiline"
        : "#editor-settings-format-lists-compact")
      .checked = true;

    // Formatter test layout...
    document
      .querySelector("#editor-settings-format-tests-compact")
      .addEventListener("change", async () => { await this.setFormatMultilineTests(false); });

    document
      .querySelector("#editor-settings-format-tests-multiline")
      .addEventListener("change", async () => { await this.setFormatMultilineTests(true); });

    document
      .querySelector(this.getFormatMultilineTests()
        ? "#editor-settings-format-tests-multiline"
        : "#editor-settings-format-tests-compact")
      .checked = true;

    // Formatter brace style...
    document
      .querySelector("#editor-settings-format-braces-same-line")
      .addEventListener("change", async () => { await this.setFormatBraceOnNewLine(false); });

    document
      .querySelector("#editor-settings-format-braces-next-line")
      .addEventListener("change", async () => { await this.setFormatBraceOnNewLine(true); });

    document
      .querySelector(this.getFormatBraceOnNewLine()
        ? "#editor-settings-format-braces-next-line"
        : "#editor-settings-format-braces-same-line")
      .checked = true;
  }

  /**
   * @inheritdoc
   */
  async render() {

    const loader = new SieveTemplate();

    const editor = document.querySelector("#sieve-plaintext-editor");
    while (editor.firstChild)
      editor.firstChild.remove();

    editor.append(
      await loader.load("./editor/text/editor.plaintext.html"));

    this.cm = CodeMirror.fromTextArea(document.querySelector(`#${this.id}`), {
      lineNumbers: true,
      lineWrapping: true,

      theme: SieveTheme.getCodeMirrorTheme(),
      matchBrackets: true,

      inputStyle: "contenteditable"
    });

    this.cm.on("renderLine", (cm, line, elt) => { this.onRenderLine(cm, line, elt); });
    this.cm.on("cursorActivity", () => { this.onActiveLineChange(); });

    this.cm.refresh();

    // Configure tab handling...
    this.cm.setOption("extraKeys", {
      "Tab": function (cm) {

        if (cm.somethingSelected()) {
          const sel = cm.getSelection("\n");
          // Indent only if there are multiple lines selected, or if the selection spans a full line
          if (sel.length > 0 && (sel.includes("\n") || sel.length === cm.getLine(cm.getCursor().line).length)) {
            cm.indentSelection("add");
            return;
          }
        }

        if (cm.options.indentWithTabs)
          cm.execCommand("insertTab");
        else
          cm.execCommand("insertSoftTab");
      },
      "Shift-Tab": function (cm) {
        cm.indentSelection("subtract");
      }
    });

    const toolbar = document.querySelector("#sieve-editor-toolbar");
    toolbar.append(
      await loader.load("./editor/text/editor.plaintext.toolbar.html"));

    document
      .querySelector("#sieve-editor-undo")
      .addEventListener("click", () => { this.undo(); });

    document
      .querySelector("#sieve-editor-redo")
      .addEventListener("click", () => { this.redo(); });

    document
      .querySelector("#sieve-editor-format")
      .addEventListener("click", () => { this.format(); });

    document
      .querySelector("#sieve-editor-cut")
      .addEventListener("click", () => { this.cut(); });

    document
      .querySelector("#sieve-editor-copy")
      .addEventListener("click", () => { this.copy(); });

    document
      .querySelector("#sieve-editor-paste")
      .addEventListener("click", () => { this.paste(); });

    document
      .querySelector("#sieve-editor-find")
      .addEventListener("click", () => {
        const token = document.querySelector("#sieve-editor-txt-find").value;

        const isReverse = document.querySelector("#sieve-editor-backward").checked;
        const isCaseSensitive = document.querySelector("#sieve-editor-casesensitive").checked;

        this.find(token, isCaseSensitive, isReverse);
      });

    document
      .querySelector("#sieve-editor-replace")
      .addEventListener("click", () => {
        const oldToken = document.querySelector("#sieve-editor-txt-find").value;
        const newToken = document.querySelector("#sieve-editor-txt-replace").value;

        const isReverse = document.querySelector("#sieve-editor-backward").checked;
        const isCaseSensitive = document.querySelector("#sieve-editor-casesensitive").checked;

        if (oldToken === "")
          return;

        this.replace(oldToken, newToken, isCaseSensitive, isReverse);
      });


    document
      .querySelector("#sieve-editor-replace-replace")
      .addEventListener("click", () => {
        document.querySelector("#sieve-editor-find-toolbar").classList.toggle("d-none");
      });

    await this.renderSettings();
  }

  /**
   * Returns the editor change status.
   *
   * @returns {boolean}
   *   true in case the document was changed otherwise false.
   */
  hasChanged() {
    return this.changed;
  }

  /**
   * @inheritdoc
   */
  async setScript(script) {
    // Load a new script. It will discard the current script
    // the cursor position is reset to defaults.

    this.cm.setValue(script);
    this.cm.setCursor({ line: 0, ch: 0 });

    this.cm.refresh();

    // ensure the active line cursor changed...
    //    onActiveLineChange();
  }

  /**
   * @inheritdoc
   */
  getScript() {

    this.focus();

    const script = this.cm.getValue();

    // ... and ensure the line endings are sanitized
    // eslint-disable-next-line no-control-regex
    return script.replace(/\r\n|\r|\n|\u0085|\u000C|\u2028|\u2029/g, "\r\n");
  }

  /**
   * @inheritdoc
   */
  focus() {
    if (this.cm)
      this.cm.focus();
  }

  /**
   * @inheritdoc
   */
  clearHistory() {
    this.cm.clearHistory();
  }

  /**
   * Checks the current script for syntax errors
   */
  async checkScript() {

    const errors = await this.getController().checkScript(await this.getScript());

    if (errors && errors !== "")
      this.showSyntaxErrors(errors);
    else
      this.hideSyntaxErrors();
  }

  /**
   * Undoes the last input
   */
  undo() {
    this.cm.undo();
    this.cm.focus();
  }

  /**
   * Redos the last input
   */
  redo() {
    this.cm.redo();
    this.cm.focus();
  }

  /**
   * Formats the complete Sieve script with tabs and line breaks.
   */
  format() {
    const script = this.cm.getValue();
    const formatted = formatSieveScript(script, {
      indentWithTabs: this.getIndentWithTabs(),
      indentWidth: this.getIndentWidth(),
      multilineLists: this.getFormatMultilineLists(),
      multilineTests: this.getFormatMultilineTests(),
      braceOnNewLine: this.getFormatBraceOnNewLine()
    });

    if (formatted === script) {
      this.cm.focus();
      return;
    }

    const lastLine = this.cm.lastLine();
    const end = { line: lastLine, ch: this.cm.getLine(lastLine).length };
    const cursorOffset = this.cm.indexFromPos(this.cm.getCursor());

    this.cm.operation(() => {
      this.cm.replaceRange(formatted, { line: 0, ch: 0 }, end, "+format");
      this.cm.setCursor(this.cm.posFromIndex(Math.min(cursorOffset, formatted.length)));
    });

    this.cm.focus();
  }

  /**
   * Cuts the currently selected text.
   */
  async cut() {
    await this.copy();
    this.cm.replaceSelection("");

    this.cm.focus();
  }

  /**
   * Copies the currently selected text.
   */
  async copy() {
    const data = this.cm.getSelection();

    await this.getController().setClipboard(data);

    this.cm.focus();
  }

  /**
   * Pastes the clipboard content into the editor.
   */
  async paste() {
    const data = await this.getController().getClipboard();
    this.cm.replaceSelection(data);

    this.cm.focus();
  }

  /**
   * Gets the selection begin
   *
   * @param {boolean} isReverse
   *   if true the selection is handled in reverse order.
   *   which means the selection start gets the selections end and vice versa.
   * @returns {int}
   *   the current start position.
   */
  getSelectionStart(isReverse) {

    const start = this.cm.getCursor(true);
    const end = this.cm.getCursor(false);

    if (isReverse) {
      if (start.line < end.line)
        return start;

      if (start.line > end.line)
        return end;

      // start.line == end.line
      if (start.ch > end.ch)
        return end;

      return start;
    }


    if (start.line > end.line)
      return start;

    if (start.line < end.line)
      return end;

    // start.line == end.line
    if (start.ch > end.ch)
      return start;

    return end;

  }

  /**
   * Finds the specified token within the editor.
   *
   * @param {string} token
   *   the string to find.
   * @param {boolean} [isCaseSensitive]
   *   if true the search is case sensitive.
   * @param {boolean} [isReverse]
   *   if true the search will be in reverse direction.
   * @returns {boolean}
   *   true in case the the string was found otherwise false.
   */
  find(token, isCaseSensitive, isReverse) {

    // Fix optional parameters...
    if (typeof (isCaseSensitive) === "undefined" || isCaseSensitive === null)
      isCaseSensitive = false;

    if (typeof (isReverse) === "undefined" || isReverse === null)
      isReverse = false;

    let cursor = this.cm.getSearchCursor(
      token,
      this.getSelectionStart(isReverse),
      !isCaseSensitive);

    if (!cursor.find(isReverse)) {
      // warp search at top or bottom
      cursor = this.cm.getSearchCursor(
        token,
        isReverse ? { line: this.cm.lineCount() - 1 } : { line: 0, ch: 0 },
        !isCaseSensitive);

      if (!cursor.find(isReverse))
        return false;
    }

    if (isReverse)
      this.cm.setSelection(cursor.from(), cursor.to());
    else
      this.cm.setSelection(cursor.to(), cursor.from());

    this.cm.scrollIntoView(cursor.to(), EDITOR_SCROLL_INTO_VIEW_OFFSET);

    return true;
  }

  /**
   * Checks if the specified token is selected.
   *
   * @param {string} token
   *   the token
   * @param {boolean} isCaseSensitive
   *   true in case the check should be case insensitive.
   * @returns {boolean}
   *   true in case the token was found otherwise false.
   */
  isSelected(token, isCaseSensitive) {
    let selection = this.cm.getSelection();

    if (isCaseSensitive) {
      selection = selection.toLowerCase();
      token = token.toLocaleLowerCase();
    }

    if (selection !== token)
      return false;

    return true;
  }

  /**
   * Replaces the old token with the new token.
   *
   * @param {string} oldToken
   *   the old token which should be replaced
   * @param {string} newToken
   *   the new token
   * @param {boolean} [isCaseSensitive]
   *   if true the search is case sensitive.
   * @param {boolean} [isReverse]
   *   if true the search will be in reverse direction.
   * @returns {boolean}
   *   true if the string was replaced, otherwise false.
   */
  replace(oldToken, newToken, isCaseSensitive, isReverse) {

    // Fix optional parameters...
    if (typeof (isCaseSensitive) === "undefined" || isCaseSensitive === null)
      isCaseSensitive = false;

    if (typeof (isReverse) === "undefined" || isReverse === null)
      isReverse = false;

    if (this.isSelected(oldToken, isCaseSensitive) === false) {
      if (this.find(oldToken, isCaseSensitive, isReverse) === false)
        return false;
    }

    this.cm.replaceSelection(newToken);

    return true;
  }

  /**
   * Callback handler for code mirror. Do not invoke unless you know what you are doing.
   *
   * @param {CodeMirror} cm
   *   a reference to the code mirror instance
   * @param {LineHandle} line
   *   the current line
   * @param {Element} element
   *   the dom element which represents the line
   */
  onRenderLine(cm, line, element) {
    const charWidth = this.cm.defaultCharWidth();
    const basePadding = 4;

    const off = CodeMirror.countColumn(line.text, null, cm.getOption("tabSize")) * charWidth;
    element.style.textIndent = "-" + off + "px";
    element.style.paddingLeft = (basePadding + off) + "px";
  }

  /**
   * On Active Line Change callback handler for codemirror.
   * Do not invoke unless you know what you are doing.
   */
  onActiveLineChange() {
    const currentLine = this.cm.getLineHandle(this.cm.getCursor().line);

    if (currentLine === this.activeLine)
      return;

    if (this.activeLine)
      this.cm.removeLineClass(this.activeLine, "background", "activeline");

    this.activeLine = this.cm.addLineClass(currentLine, "background", "activeline");
  }

  /**
   * Shows a message box with the given syntax errors
   * @param {string} errors
   *   the errors which should be displayed
   */
  showSyntaxErrors(errors) {
    const msg = document.querySelector("#sieve-editor-msg");
    msg.style.display = '';

    const details = msg.querySelector(".sieve-editor-msg-details");
    while (details.firstChild)
      details.firstChild.remove();

    details.textContent = errors;
  }

  /**
   * Hides the syntax errors.
   */
  hideSyntaxErrors() {
    document.querySelector("#sieve-editor-msg").style.display = 'none';
  }

  /**
   * Sets the editors indentation width.
   *
   * @param {int} width
   *   the indentation width in characters
   * @returns {SieveEditorUI}
   *   a self reference
   */
  async setIndentWidth(width) {
    width = Number.parseInt(width, 10);

    if (Number.isNaN(width))
      throw new Error("Invalid Indent width");

    this.cm.setOption("indentUnit", width);
    await this.getController().setPreference("indentation-width", width);

    return this;
  }

  /**
   * Returns the indentation width.
   *
   * @returns {int}
   *   the indentation width in characters.
   */
  getIndentWidth() {
    return this.cm.getOption("indentUnit");
  }

  /**
   * Sets the indent policy.
   *
   * @param {boolean} useTabs
   *   if true tabs are used for indenting otherwise spaces are used.
   * @returns {SieveEditorUI}
   *   a self reference
   */
  async setIndentWithTabs(useTabs) {
    this.cm.setOption("indentWithTabs", useTabs);

    await this.getController().setPreference("indentation-policy", useTabs);

    return this;
  }

  /**
   * Returns the indent policy.
   *
   * @returns {boolean}
   *   true in case tabs are used to indent. False if spaces are used.
   */
  getIndentWithTabs() {
    return this.cm.getOption("indentWithTabs");
  }

  /**
   * Sets the editor's tabulator width and persists the changed value.
   *
   * @param {int} tabSize
   *   the tabulator width in characters
   * @returns {SieveEditorUI}
   *   a self reference
   */
  async setTabWidth(tabSize) {
    tabSize = Number.parseInt(tabSize, 10);

    if (Number.isNaN(tabSize))
      throw new Error(`Invalid Tab width ${tabSize}`);

    this.cm.setOption("tabSize", tabSize);

    await this.getController().setPreference("tabulator-width", tabSize);

    return this;
  }

  /**
   * Gets the editor's tabulator width.
   * @returns {int}
   *   the tabulator width in characters.
   */
  getTabWidth() {
    return this.cm.getOption("tabSize");
  }

  /**
   * Sets whether string lists are formatted across multiple lines.
   *
   * @param {boolean} value
   *   true for one list value per line.
   * @returns {SieveEditorUI}
   *   a self reference.
   */
  async setFormatMultilineLists(value) {
    this.formatMultilineLists = value === true;
    await this.getController().setPreference(
      "format-lists-multiline", this.formatMultilineLists);

    return this;
  }

  /**
   * Gets the configured string list layout.
   *
   * @returns {boolean}
   *   true for one list value per line.
   */
  getFormatMultilineLists() {
    return this.formatMultilineLists;
  }

  /**
   * Sets whether test arguments are formatted across multiple lines.
   *
   * @param {boolean} value
   *   true for one test argument per line.
   * @returns {SieveEditorUI}
   *   a self reference.
   */
  async setFormatMultilineTests(value) {
    this.formatMultilineTests = value === true;
    await this.getController().setPreference(
      "format-tests-multiline", this.formatMultilineTests);

    return this;
  }

  /**
   * Gets the configured test argument layout.
   *
   * @returns {boolean}
   *   true for one test argument per line.
   */
  getFormatMultilineTests() {
    return this.formatMultilineTests;
  }

  /**
   * Sets whether opening block braces are put on a separate line.
   *
   * @param {boolean} value
   *   true for a separate opening brace line.
   * @returns {SieveEditorUI}
   *   a self reference.
   */
  async setFormatBraceOnNewLine(value) {
    this.formatBraceOnNewLine = value === true;
    await this.getController().setPreference(
      "format-brace-new-line", this.formatBraceOnNewLine);

    return this;
  }

  /**
   * Gets the configured opening brace style.
   *
   * @returns {boolean}
   *   true for a separate opening brace line.
   */
  getFormatBraceOnNewLine() {
    return this.formatBraceOnNewLine;
  }

  /**
   * @inheritdoc
   */
  async loadSettings() {
    const tabWidth = await this.getController().getPreference("tabulator-width");
    await this.setTabWidth(tabWidth);

    const IndentWithTabs = await this.getController().getPreference("indentation-policy");
    await this.setIndentWithTabs(IndentWithTabs);

    const indentWidth = await this.getController().getPreference("indentation-width");
    await this.setIndentWidth(indentWidth);

    const multilineLists = await this.getController().getPreference("format-lists-multiline");
    await this.setFormatMultilineLists(multilineLists);

    const multilineTests = await this.getController().getPreference("format-tests-multiline");
    await this.setFormatMultilineTests(multilineTests);

    const braceOnNewLine = await this.getController().getPreference("format-brace-new-line");
    await this.setFormatBraceOnNewLine(braceOnNewLine);

  }

  /**
   * @inheritdoc
   */
  async loadDefaultSettings() {
    const tabWidth = await this.getController().getDefaultPreference("tabulator-width");
    await this.setTabWidth(tabWidth);

    const IndentWithTabs = await this.getController().getDefaultPreference("indentation-policy");
    await this.setIndentWithTabs(IndentWithTabs);

    const indentWidth = await this.getController().getDefaultPreference("indentation-width");
    await this.setIndentWidth(indentWidth);

    const multilineLists = await this.getController().getDefaultPreference("format-lists-multiline");
    await this.setFormatMultilineLists(multilineLists);

    const multilineTests = await this.getController().getDefaultPreference("format-tests-multiline");
    await this.setFormatMultilineTests(multilineTests);

    const braceOnNewLine = await this.getController().getDefaultPreference("format-brace-new-line");
    await this.setFormatBraceOnNewLine(braceOnNewLine);

    await this.renderSettings();
  }

  /**
   * @inheritdoc
   */
  async saveDefaultSettings() {
    await this.getController().setDefaultPreference("tabulator-width", this.getTabWidth());

    await this.getController().setDefaultPreference("indentation-policy", this.getIndentWithTabs());
    await this.getController().setDefaultPreference("indentation-width", this.getIndentWidth());

    await this.getController().setDefaultPreference(
      "format-lists-multiline", this.getFormatMultilineLists());
    await this.getController().setDefaultPreference(
      "format-tests-multiline", this.getFormatMultilineTests());
    await this.getController().setDefaultPreference(
      "format-brace-new-line", this.getFormatBraceOnNewLine());

  }

}

export { SieveTextEditorUI };
