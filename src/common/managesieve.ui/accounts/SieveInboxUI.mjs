/*
 * Searchable Inbox view with an integrated Sieve rule editor.
 */

/* global bootstrap */

import { formatSieveScript } from "./../editor/text/SieveFormatter.mjs";
import {
  createInboxRuleTemplate,
  getLiteralFileintoMailboxes,
  getInboxRuleRequirements,
  inspectInboxRuleMailboxes,
  stripLeadingSieveRequirements
} from "./../inbox/SieveInboxRule.mjs";
import { matchesSpamSearch } from "./../spam/SieveSpamMessage.mjs";
import { findSpamRuleMatches } from "./../spam/SieveSpamRule.mjs";
import { SieveI18n } from "./../utils/SieveI18n.mjs";
import { SieveTheme } from "./../utils/SieveTheme.mjs";
import { showCheckSuccess } from "./../utils/SieveUiFeedback.mjs";

let ruleEditorSequence = 0;

/**
 * Formats an Inbox date in a locale-independent, sortable representation.
 *
 * The displayed components use the user's local time zone, just like the
 * previous localized date, but do not depend on operating-system locale.
 *
 * @param {Date|string|number|null} value
 *   message date.
 * @returns {string}
 *   yyyy.mm.dd, hh:mm:ss or an empty string for an invalid date.
 */
function formatInboxDate(value) {
  if (value === null || value === undefined || value === "")
    return "";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    return "";

  const pad = (part, width = 2) => { return `${part}`.padStart(width, "0"); };
  return `${pad(date.getFullYear(), 4)}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}, `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Sorts Inbox messages newest first without changing the source array.
 *
 * Messages with missing or invalid dates stay at the end. Equal timestamps
 * retain their source order.
 *
 * @param {object[]} messages
 *   messages to sort.
 * @returns {object[]}
 *   chronologically sorted copy.
 */
function sortInboxMessagesByDate(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message, index) => {
      const value = message?.date;
      const timestamp = value === null || value === undefined || value === ""
        ? Number.NaN : new Date(value).getTime();
      return {
        message,
        index,
        timestamp: Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
      };
    })
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp)
        return right.timestamp - left.timestamp;

      return left.index - right.index;
    })
    .map((item) => { return item.message; });
}

/**
 * Formats possible existing-rule matches for the read-only Inbox helper.
 *
 * @param {object[]} matches
 *   results returned by findSpamRuleMatches().
 * @param {object} labels
 *   localized criterion and source labels.
 * @returns {string}
 *   copyable match summary.
 */
function formatInboxRuleMatches(matches, labels) {
  const sections = [];
  for (const result of matches || []) {
    const lines = [`# ${result.name}${result.active
      ? ` (${labels.active})` : ""}`];
    for (const match of result.matches || []) {
      lines.push(`${labels[match.type] || match.type}: ${match.value}`);
      for (const occurrence of match.occurrences || []) {
        lines.push(`${labels.line} ${occurrence.line}:`);
        lines.push(occurrence.context || occurrence.excerpt);
      }
    }
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

/**
 * Renders one account's Inbox and its inline rule helper.
 */
class SieveInboxUI {

  /**
   * @param {object} account
   *   owning account UI.
   * @param {HTMLElement} root
   *   Inbox tab pane.
   */
  constructor(account, root) {
    this.account = account;
    this.root = root;
    this.messages = [];
    this.mailboxes = [];
    this.selectedId = null;
    this.details = null;
    this.scripts = [];
    this.ruleScriptsConnected = false;
    this.lastTemplate = "";
    this.ruleCapabilities = { extensions: {} };
    this.ruleGraphicalEditorFrame = null;
    this.ruleGraphicalEditorReady = null;
    this.ruleGraphicalEditorWindow = null;
    this.ruleGraphicalSourceLoaded = false;
    this.ruleEditorSequence = ++ruleEditorSequence;
    this.ruleLoadSequence = 0;
    this.editingRule = null;
    this.rendering = false;
    this.inboxConfigured = false;

    const search = root.querySelector(".sieve-inbox-search");
    const searchLabel = root.querySelector(".sieve-inbox-search-label");
    const searchId = `sieve-inbox-search-${account.id}`;
    search.id = searchId;
    searchLabel.htmlFor = searchId;
    const datalist = root.querySelector(".sieve-inbox-rule-mailboxes");
    datalist.id = `sieve-inbox-mailboxes-${account.id}`;
    root.querySelector(".sieve-inbox-rule-mailbox")
      .setAttribute("list", datalist.id);
    search.placeholder = this.string(
      "account.inbox.search", "Search sender, recipient or subject");
    searchLabel.textContent = this.string(
      "account.inbox.search.label", "Search Inbox messages");

    root.querySelector(".sieve-inbox-refresh").textContent
      = this.string("account.inbox.refresh", "Refresh");
    root.querySelector(".sieve-inbox-apply-selected").textContent
      = this.string("account.inbox.apply", "Run Sieve now");
    root.querySelector(".sieve-inbox-mark-spam").textContent
      = this.string("account.inbox.spam", "Spam");
    root.querySelector(".sieve-inbox-create-rule").textContent
      = this.string("account.inbox.rule.create", "Create Sieve Rule");
    root.querySelector(".sieve-inbox-context-apply").textContent
      = this.string("account.inbox.apply", "Run Sieve now");
    root.querySelector(".sieve-inbox-context-rule").textContent
      = this.string("account.inbox.rule.create", "Create Sieve Rule");
    const headings = root.querySelectorAll("thead th");
    headings[0].textContent = this.string("account.inbox.select.column", "#");
    headings[1].textContent = this.string("account.inbox.date", "Date");
    headings[2].textContent = this.string("account.inbox.sender", "Sender");
    headings[3].textContent = this.string("account.inbox.subject", "Subject");

    search.addEventListener("input", () => { this.renderRows(); });
    root.querySelector(".sieve-inbox-refresh")
      .addEventListener("click", () => { this.render(true); });
    root.querySelector(".sieve-inbox-apply-selected")
      .addEventListener("click", () => { this.applySelected(); });
    root.querySelector(".sieve-inbox-mark-spam")
      .addEventListener("click", () => { this.markSelectedAsSpam(); });
    root.querySelector(".sieve-inbox-create-rule")
      .addEventListener("click", () => { this.openRuleEditor(); });
    root.querySelector(".sieve-inbox-context-apply")
      .addEventListener("click", () => {
        this.hideContextMenu();
        this.applySelected();
      });
    root.querySelector(".sieve-inbox-context-rule")
      .addEventListener("click", () => {
        this.hideContextMenu();
        this.openRuleEditor();
      });
    root.addEventListener("click", () => { this.hideContextMenu(); });
    root.ownerDocument.addEventListener("keydown", (event) => {
      if (event.key === "Escape")
        this.hideContextMenu();
    });

    this.initializeRuleEditor();
  }

  /**
   * Gets a translated string with an English fallback.
   *
   * @param {string} key
   *   translation key.
   * @param {string} fallback
   *   fallback string.
   * @returns {string}
   *   translated string.
   */
  string(key, fallback) {
    try {
      return SieveI18n.getInstance().getString(key);
    } catch {
      return fallback;
    }
  }

  /**
   * Shows a status in the Inbox pane.
   *
   * @param {string} text
   *   status text.
   * @param {string} [style]
   *   Bootstrap alert style.
   */
  setStatus(text, style = "secondary") {
    const status = this.root.querySelector(".sieve-inbox-status");
    status.className = `alert alert-${style} py-2 sieve-inbox-status`;
    status.textContent = text;
    status.style.whiteSpace = "pre-wrap";
  }

  /**
   * Returns messages matching the search field.
   *
   * @returns {object[]}
   *   visible messages.
   */
  getVisibleMessages() {
    const query = this.root.querySelector(".sieve-inbox-search").value;
    return sortInboxMessagesByDate(
      this.messages.filter((message) => { return matchesSpamSearch(message, query); }));
  }

  /**
   * Selects exactly one Inbox message.
   *
   * @param {string} id
   *   message identifier.
   */
  selectMessage(id) {
    this.selectedId = id;
    this.root.querySelector(".sieve-inbox-create-rule").disabled = !id;
    this.root.querySelector(".sieve-inbox-apply-selected").disabled
      = !id || !this.inboxConfigured;
    this.root.querySelector(".sieve-inbox-mark-spam").disabled
      = !id || !this.inboxConfigured;
    this.root.querySelectorAll(".sieve-inbox-select").forEach((control) => {
      control.checked = control.value === id;
    });
  }

  /**
   * Opens the row context menu and makes that row the exact action target.
   *
   * @param {MouseEvent} event
   *   contextmenu event.
   * @param {string} id
   *   message identifier.
   */
  showContextMenu(event, id) {
    event.preventDefault();
    this.selectMessage(id);

    const menu = this.root.querySelector(".sieve-inbox-context-menu");
    const apply = menu.querySelector(".sieve-inbox-context-apply");
    apply.disabled = !this.inboxConfigured;
    menu.classList.add("show");
    menu.style.left = "0px";
    menu.style.top = "0px";

    const bounds = menu.getBoundingClientRect();
    const view = this.root.ownerDocument.defaultView;
    const left = Math.max(0, Math.min(
      event.clientX, view.innerWidth - bounds.width));
    const top = Math.max(0, Math.min(
      event.clientY, view.innerHeight - bounds.height));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  /**
   * Closes the Inbox row context menu.
   */
  hideContextMenu() {
    this.root.querySelector(".sieve-inbox-context-menu")
      .classList.remove("show");
  }

  /**
   * Draws the current Inbox rows using text nodes only.
   */
  renderRows() {
    const rows = this.root.querySelector(".sieve-inbox-rows");
    const visible = this.getVisibleMessages();
    rows.replaceChildren();

    for (const message of visible) {
      const row = document.createElement("tr");
      const selectionCell = document.createElement("td");
      const selection = document.createElement("input");
      selection.type = "radio";
      selection.name = `sieve-inbox-select-${this.account.id}`;
      selection.value = message.id;
      selection.className = "form-check-input sieve-inbox-select";
      selection.checked = this.selectedId === message.id;
      selection.setAttribute("aria-label", `${this.string(
        "account.inbox.select", "Select message")}: ${message.subject}`);
      selection.addEventListener("change", () => { this.selectMessage(message.id); });
      selectionCell.append(selection);
      row.append(selectionCell);

      const date = document.createElement("td");
      date.className = "text-nowrap small";
      date.textContent = formatInboxDate(message.date);
      row.append(date);

      const author = document.createElement("td");
      const authorText = document.createElement("span");
      authorText.className = "sieve-inbox-cell-text";
      authorText.textContent = message.author;
      authorText.title = message.author;
      author.append(authorText);
      row.append(author);

      const subject = document.createElement("td");
      const subjectText = document.createElement("span");
      subjectText.className = "sieve-inbox-cell-text";
      subjectText.textContent = message.subject
        || this.string("account.inbox.no.subject", "(No subject)");
      subjectText.title = subjectText.textContent;
      subject.append(subjectText);
      row.append(subject);

      row.addEventListener("click", (event) => {
        if (event.target !== selection)
          this.selectMessage(message.id);
      });
      row.addEventListener("contextmenu", (event) => {
        this.showContextMenu(event, message.id);
      });
      rows.append(row);
    }

    this.root.querySelector(".sieve-inbox-table-wrap")
      .classList.toggle("d-none", visible.length === 0);
    if (this.messages.length && !visible.length) {
      this.setStatus(this.string(
        "account.inbox.search.empty", "No Inbox messages match this search."));
    } else if (this.messages.length) {
      this.setStatus(`${visible.length} ${this.string(
        "account.inbox.visible", "of")} ${this.messages.length} ${this.string(
        "account.inbox.messages", "messages")}.`);
    }
  }

  /**
   * Displays the destructive-action confirmation.
   *
   * @param {string} prompt
   *   localized operation summary and warning.
   * @returns {boolean}
   *   whether the user accepted the operation.
   */
  confirmApply(prompt) {
    return window.confirm(prompt);
  }

  /**
   * Applies the active server-side Sieve script to the selected Inbox message.
   *
   * The backend revalidates the selected message's identity and performs a
   * targeted UID EXPUNGE after a successful FILTER operation.
   */
  async applySelected() {
    const button = this.root.querySelector(".sieve-inbox-apply-selected");
    const selected = this.messages.find((message) => {
      return message.id === this.selectedId;
    });
    if (!selected)
      return;

    button.disabled = true;
    try {
      await this.ensureSieveConnected();
      this.setStatus(this.string(
        "account.inbox.apply.running", "Applying the active Sieve script…"));
      const result = await this.account.send("account-inbox-apply-selected", {
        messageId: selected.id
      });
      await this.render(true);
      const style = result.errors ? "warning" : "success";
      const details = [];
      if (result.createdMailboxes?.length) {
        details.push(`${this.string(
          "account.inbox.apply.created", "Created mailboxes")}: ${result.createdMailboxes.join(", ")}`);
      }
      if (result.expunged) {
        details.push(this.string(
          "account.inbox.apply.expunged",
          "The selected original message was permanently removed after the rule was applied."));
      }
      if (result.reports?.length) {
        details.push(`${this.string(
          "account.inbox.apply.reports", "Server report")}:
${result.reports.join("\n")}`);
      } else {
        details.push(this.string(
          "account.inbox.apply.no.reports",
          "The server returned no detailed action report."));
      }
      this.setStatus(`${this.string(
        "account.inbox.apply.done", "Sieve was run on the selected Inbox message")}: `
        + `${result.script} (${result.filtered} ${this.string(
          "account.inbox.apply.filtered", "visible actions or reports")}, `
        + `${result.warnings} ${this.string(
          "account.inbox.apply.warnings", "warnings")}, ${result.errors} ${this.string(
          "account.inbox.apply.errors", "errors")}).\n${details.join("\n")}`, style);
    } catch (ex) {
      this.setStatus(`${this.string(
        "account.inbox.apply.error", "Could not run Sieve")}: ${ex.message || ex}`,
      "danger");
    } finally {
      button.disabled = !this.selectedId || !this.inboxConfigured;
    }
  }

  /**
   * Marks the selected Inbox message as junk, moves it to Junk and queues it
   * for the server's authenticated spam-training helper.
   */
  async markSelectedAsSpam() {
    const button = this.root.querySelector(".sieve-inbox-mark-spam");
    const selected = this.messages.find((message) => {
      return message.id === this.selectedId;
    });
    if (!selected)
      return;

    const subject = selected.subject
      || this.string("account.inbox.no.subject", "(No subject)");
    const prompt = this.string(
      "account.inbox.spam.confirm",
      "Mark the selected message from {date} with subject “{subject}” as spam, move it to Junk and queue server-side spam training?")
      .replace("{date}", formatInboxDate(selected.date))
      .replace("{subject}", subject);
    if (!this.confirmApply(prompt))
      return;

    button.disabled = true;
    this.setStatus(this.string(
      "account.inbox.spam.running", "Marking and queuing the message as spam…"));
    try {
      const result = await this.account.send("account-inbox-mark-spam", {
        messageId: selected.id
      });
      await this.render();
      this.setStatus(`${this.string(
        "account.inbox.spam.done",
        "The message was marked as spam, moved to Junk and queued for Rspamd analysis and training")}: ${result.folder}.`,
      "success");
    } catch (ex) {
      this.setStatus(`${this.string(
        "account.inbox.spam.error", "Could not mark the message as spam")}: ${ex.message || ex}`,
      "danger");
    } finally {
      button.disabled = !this.selectedId || !this.inboxConfigured;
    }
  }

  /**
   * Loads the account Inbox.
   *
   * @param {boolean} refresh
   *   true to synchronize the folder with its incoming server first.
   */
  async render(refresh = false) {
    if (this.rendering)
      return;

    this.rendering = true;
    const refreshButton = this.root.querySelector(".sieve-inbox-refresh");
    refreshButton.disabled = true;
    this.selectedId = null;
    this.inboxConfigured = false;
    this.root.querySelector(".sieve-inbox-create-rule").disabled = true;
    this.root.querySelector(".sieve-inbox-apply-selected").disabled = true;
    this.root.querySelector(".sieve-inbox-mark-spam").disabled = true;
    this.root.querySelector(".sieve-inbox-table-wrap").classList.add("d-none");
    this.hideContextMenu();
    this.setStatus(this.string("account.inbox.loading", "Loading Inbox…"));

    try {
      const data = await this.account.send("account-inbox-list", {
        refresh: refresh === true
      });
      this.messages = data.messages || [];
      this.mailboxes = data.mailboxes || [];
      this.inboxConfigured = data.configured !== false;
      this.renderRows();

      if (data.configured === false) {
        this.setStatus(this.string(
          "account.inbox.imap.disabled",
          "Enable and configure direct IMAP access in Properties > Server."),
        "warning");
      } else if (!this.messages.length) {
        this.setStatus(`${data.folderName}: ${this.string(
          "account.inbox.empty", "No messages found.")}`, "success");
      }
    } catch (ex) {
      console.error("Could not load Inbox", ex);
      this.messages = [];
      this.root.querySelector(".sieve-inbox-rows").replaceChildren();
      this.setStatus(`${this.string(
        "account.inbox.error", "Could not load Inbox")}: ${ex.message || ex}`, "danger");
    } finally {
      this.rendering = false;
      refreshButton.disabled = false;
    }
  }

  /**
   * Initializes labels and controls in the integrated editor.
   */
  initializeRuleEditor() {
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    modal.querySelector(".sieve-inbox-rule-title").textContent
      = this.string("account.inbox.rule.title", "Create Sieve rule from Inbox message");
    modal.querySelector(".sieve-inbox-rule-headers-label").textContent
      = this.string("account.inbox.rule.headers", "Message headers (selectable for copy and paste)");
    modal.querySelector(".sieve-inbox-rule-script-label").textContent
      = this.string("account.inbox.rule.script", "Add to Sieve script");
    modal.querySelector(".sieve-inbox-rule-mailbox-label").textContent
      = this.string("account.inbox.rule.mailbox", "Destination mailbox for fileinto");
    modal.querySelector(".sieve-inbox-rule-similar-label").textContent
      = this.string("account.inbox.rule.similar", "Possible existing rules (read only)");
    modal.querySelector(".sieve-inbox-rule-source-label").textContent
      = this.string("account.inbox.rule.source", "Sieve rule");
    const graphicalTab = modal.querySelector(".sieve-inbox-rule-graphical-tab");
    const sourceTab = modal.querySelector(".sieve-inbox-rule-source-tab");
    const graphicalPane = modal.querySelector(".sieve-inbox-rule-graphical-pane");
    const sourcePane = modal.querySelector(".sieve-inbox-rule-source-pane");
    graphicalTab.textContent = this.string("editor.script", "Script");
    sourceTab.textContent = this.string("editor.source", "Source");
    graphicalTab.id = `sieve-inbox-rule-graphical-tab-${this.ruleEditorSequence}`;
    sourceTab.id = `sieve-inbox-rule-source-tab-${this.ruleEditorSequence}`;
    graphicalPane.id = `sieve-inbox-rule-graphical-${this.ruleEditorSequence}`;
    sourcePane.id = `sieve-inbox-rule-source-${this.ruleEditorSequence}`;
    graphicalTab.dataset.bsTarget = `#${graphicalPane.id}`;
    sourceTab.dataset.bsTarget = `#${sourcePane.id}`;
    graphicalTab.setAttribute("aria-controls", graphicalPane.id);
    sourceTab.setAttribute("aria-controls", sourcePane.id);
    graphicalPane.setAttribute("aria-labelledby", graphicalTab.id);
    sourcePane.setAttribute("aria-labelledby", sourceTab.id);
    modal.querySelector(".sieve-inbox-rule-template").textContent
      = this.string("account.inbox.rule.template", "Create fileinto rule");
    modal.querySelector(".sieve-inbox-rule-lint").textContent
      = this.string("account.inbox.rule.lint", "Lint");
    modal.querySelector(".sieve-inbox-rule-pretty").textContent
      = this.string("account.inbox.rule.pretty", "Pretty Print");
    modal.querySelector(".sieve-inbox-rule-save").textContent
      = this.string("account.inbox.rule.save", "Save");

    this.initializeRuleGraphicalEditor(modal);
    modal.querySelector(".sieve-inbox-rule-source")
      .addEventListener("input", () => { this.updateMailboxStatus(); });
    modal.querySelector(".sieve-inbox-rule-script")
      .addEventListener("change", () => {
        this.editingRule = null;
        this.updateRuleActionState();
      });
    graphicalTab.addEventListener("click", async () => {
      await this.showRuleGraphicalTab();
    });
    sourceTab.addEventListener("click", () => { this.showRuleSourceTab(); });
    modal.querySelector(".sieve-inbox-rule-mailbox")
      .addEventListener("input", async () => { await this.updateTemplateMailbox(); });
    modal.querySelector(".sieve-inbox-rule-template")
      .addEventListener("click", async () => { await this.createTemplate(); });
    modal.querySelector(".sieve-inbox-rule-lint")
      .addEventListener("click", () => { this.lintRule(); });
    modal.querySelector(".sieve-inbox-rule-pretty")
      .addEventListener("click", async () => { await this.prettyPrintRule(); });
    modal.querySelector(".sieve-inbox-rule-save")
      .addEventListener("click", () => { this.saveRule(); });
    modal.addEventListener("hidden.bs.modal", () => {
      // Stop an older modal invocation from starting further GETSCRIPT
      // requests after the user has already closed it.
      this.ruleLoadSequence++;
    });
  }

  /**
   * Connects the rule field to the graphical editor used by the full
   * editor's "Script" tab. The hidden textarea remains a fallback for tests
   * and for reporting a useful value while the iframe is still loading.
   *
   * @param {HTMLElement} modal
   *   rule editor modal.
   */
  initializeRuleGraphicalEditor(modal) {
    const frame = modal.querySelector(".sieve-inbox-rule-editor");
    frame.title = this.string(
      "account.inbox.rule.graphical", "Graphical Sieve rule editor");
    this.ruleGraphicalEditorFrame = frame;
    this.ruleGraphicalEditorReady = new Promise((resolve) => {
      const connect = () => {
        const editor = frame.contentWindow;
        if (editor?.sieveGuiReady) {
          resolve(editor);
          return;
        }

        editor?.addEventListener("sieve-gui-ready", () => {
          resolve(editor);
        }, { once: true });
      };

      frame.addEventListener("load", connect);
      if (frame.contentDocument?.readyState === "complete")
        connect();
    });
    this.ruleGraphicalEditorReady.then((editor) => {
      this.ruleGraphicalEditorWindow = editor;
      this.syncRuleEditorTheme();
    });

    modal.addEventListener("shown.bs.modal", () => {
      this.syncRuleEditorTheme();
      frame.focus();
    });
    window.addEventListener("sieve-theme-changed", () => {
      this.syncRuleEditorTheme();
    });
  }

  /** Synchronizes the embedded graphical editor with the application theme. */
  syncRuleEditorTheme() {
    const root = this.ruleGraphicalEditorFrame?.contentDocument?.documentElement;
    if (!root)
      return;

    root.setAttribute("data-bs-theme", SieveTheme.effective);
    root.setAttribute("data-sieve-theme", SieveTheme.preset);
  }

  /**
   * Waits for the embedded graphical editor with a bounded loading time.
   *
   * @returns {Promise<Window>}
   *   iframe window exposing setSieveScript() and getSieveScript().
   */
  async getRuleGraphicalEditor() {
    if (this.ruleGraphicalEditorWindow)
      return this.ruleGraphicalEditorWindow;

    if (!this.ruleGraphicalEditorReady)
      return null;

    return await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error(this.string(
          "account.inbox.rule.graphical.error",
          "The graphical Sieve editor could not be loaded")));
      }, 15000);

      this.ruleGraphicalEditorReady.then((editor) => {
        window.clearTimeout(timeout);
        resolve(editor);
      });
    });
  }

  /** Shows the source tab and copies any loaded graphical changes into it. */
  showRuleSourceTab() {
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    if (this.ruleGraphicalSourceLoaded
        && this.ruleGraphicalEditorWindow?.getSieveScript) {
      try {
        modal.querySelector(".sieve-inbox-rule-source").value
          = stripLeadingSieveRequirements(
            this.ruleGraphicalEditorWindow.getSieveScript());
      } catch (ex) {
        this.setEditorStatus(`${this.string(
          "account.inbox.rule.graphical.read.error",
          "The graphical rule could not be transferred to source code")}: ${ex.message || ex}`,
        "warning");
      }
    }

    bootstrap.Tab.getOrCreateInstance(
      modal.querySelector(".sieve-inbox-rule-source-tab")).show();
    this.updateMailboxStatus();
  }

  /**
   * Copies source text to the graphical editor before showing its tab.
   */
  async showRuleGraphicalTab() {
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    try {
      await this.setRuleGraphicalSource(
        modal.querySelector(".sieve-inbox-rule-source").value);
      bootstrap.Tab.getOrCreateInstance(
        modal.querySelector(".sieve-inbox-rule-graphical-tab")).show();
    } catch (ex) {
      this.showRuleSourceTab();
      this.setEditorStatus(`${this.string(
        "account.inbox.rule.graphical.error",
        "The graphical Sieve editor could not be loaded")}: ${ex.message || ex}`,
      "warning");
    }
  }

  /**
   * Loads source into the iframe and enables all extensions needed by the
   * generated snippet so the graphical parser can display it.
   *
   * @param {string} source
   *   editable rule source.
   */
  async setRuleGraphicalSource(source) {
    const editor = await this.getRuleGraphicalEditor();
    if (!editor)
      return;

    const extensions = {
      ...(this.ruleCapabilities?.extensions || {})
    };
    for (const requirement of getInboxRuleRequirements(source))
      extensions[requirement] = true;

    editor.setSieveScript(source, JSON.stringify(extensions));
    this.ruleGraphicalEditorWindow = editor;
    this.ruleGraphicalSourceLoaded = true;
    this.syncRuleEditorTheme();
  }

  /**
   * Returns the currently editable rule source.
   *
   * @returns {string}
   *   rule snippet from the graphical editor or its textarea fallback.
   */
  getRuleSource() {
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    const graphicalActive = modal.querySelector(
      ".sieve-inbox-rule-graphical-tab")?.classList.contains("active");
    if (graphicalActive && this.ruleGraphicalSourceLoaded
        && this.ruleGraphicalEditorWindow?.getSieveScript) {
      return stripLeadingSieveRequirements(
        this.ruleGraphicalEditorWindow.getSieveScript());
    }

    return modal.querySelector(".sieve-inbox-rule-source").value;
  }

  /**
   * Replaces the currently editable rule source.
   *
   * @param {string} source
   *   new rule source.
   */
  async setRuleSource(source) {
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    modal.querySelector(".sieve-inbox-rule-source").value = source;
    await this.setRuleGraphicalSource(source);
  }

  /**
   * Ensures that the account has an active ManageSieve connection.
   *
   * The rule editor needs the live script list for its target selector. An
   * offline account is therefore connected before any scripts are requested.
   *
   * @returns {Promise<boolean>}
   *   true when a new connection was established, otherwise false.
   */
  async ensureSieveConnected() {
    if (await this.account.isConnected())
      return false;

    this.setStatus(this.string(
      "account.inbox.rule.connecting", "Connecting the Sieve client…"));
    await this.account.send("account-connect");

    if (!await this.account.isConnected()) {
      throw new Error(this.string(
        "account.inbox.rule.connect.failed", "The Sieve client could not connect"));
    }

    // Updating the complete account view would list all scripts here and then
    // list/fetch them again below. Besides being redundant, a stalled first
    // LISTSCRIPTS request leaves the rule modal at its loading message.
    this.account.setConnectionActions?.(true, false);
    return true;
  }

  /** Enables server actions only after the selected script body is loaded. */
  updateRuleActionState() {
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    const name = modal.querySelector(".sieve-inbox-rule-script").value;
    const script = this.scripts.find((item) => { return item.name === name; });
    const ready = this.ruleScriptsConnected
      && typeof script?.content === "string";

    modal.querySelector(".sieve-inbox-rule-lint").disabled = !ready;
    modal.querySelector(".sieve-inbox-rule-save").disabled = !ready;
  }

  /**
   * Opens the editor for the selected Inbox message.
   */
  async openRuleEditor() {
    if (!this.selectedId)
      return;

    const messageId = this.selectedId;
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    const dialog = bootstrap.Modal.getOrCreateInstance(modal);
    const headers = modal.querySelector(".sieve-inbox-rule-headers");
    const similar = modal.querySelector(".sieve-inbox-rule-similar");
    const source = modal.querySelector(".sieve-inbox-rule-source");
    const scriptSelect = modal.querySelector(".sieve-inbox-rule-script");
    const loadSequence = ++this.ruleLoadSequence;

    this.details = null;
    this.scripts = [];
    this.ruleScriptsConnected = false;
    this.lastTemplate = "";
    this.ruleCapabilities = { extensions: {} };
    this.ruleGraphicalSourceLoaded = false;
    this.editingRule = null;
    headers.value = this.string(
      "account.inbox.rule.headers.loading", "Loading message headers…");
    similar.textContent = this.string(
      "account.inbox.rule.similar.loading", "Checking existing rules…");
    source.value = "";
    scriptSelect.replaceChildren();
    modal.querySelector(".sieve-inbox-rule-connection").textContent = "";
    this.setEditorStatus(this.string(
      "account.inbox.rule.loading", "Loading headers and Sieve scripts…"));
    modal.querySelector(".sieve-inbox-rule-lint").disabled = true;
    modal.querySelector(".sieve-inbox-rule-save").disabled = true;
    dialog.show();

    let graphicalEditorLoaded = false;
    try {
      // Message data does not depend on ManageSieve. Render it first so a
      // connection or graphical-editor error cannot leave the whole modal
      // looking empty.
      const details = await this.account.send(
        "account-inbox-details", { messageId });
      this.details = details;
      headers.value = details.headers || this.string(
        "account.inbox.rule.headers.empty", "No raw message headers are available.");

      const datalist = modal.querySelector(".sieve-inbox-rule-mailboxes");
      datalist.replaceChildren();
      for (const mailbox of this.mailboxes) {
        const option = document.createElement("option");
        option.value = mailbox;
        datalist.append(option);
      }

      modal.querySelector(".sieve-inbox-rule-mailbox").value = "INBOX";
      this.lastTemplate = createInboxRuleTemplate(details, "INBOX");
      source.value = this.lastTemplate;
      this.updateMailboxStatus();

      // The generated rule does not depend on the server script list. Render
      // it now so a slow connection cannot leave the graphical canvas empty.
      try {
        await this.setRuleGraphicalSource(this.lastTemplate);
        graphicalEditorLoaded = true;
      } catch (ex) {
        this.showRuleSourceTab();
        this.setEditorStatus(`${this.string(
          "account.inbox.rule.graphical.error",
          "The graphical Sieve editor could not be loaded")}: ${ex.message || ex}`,
        "warning");
      }

      similar.textContent = this.string(
        "account.inbox.rule.connecting", "Connecting the Sieve client…");
      await this.ensureSieveConnected();
      if (loadSequence !== this.ruleLoadSequence)
        return;

      similar.textContent = this.string(
        "account.inbox.rule.scripts.loading", "Loading Sieve scripts…");
      const scripts = await this.account.send("account-inbox-rule-scripts");
      if (loadSequence !== this.ruleLoadSequence)
        return;

      this.scripts = scripts.scripts || [];
      this.ruleScriptsConnected = !!scripts.connected;

      for (const script of this.scripts) {
        const option = document.createElement("option");
        option.value = script.name;
        option.textContent = script.active
          ? `${script.name} (${this.string("account.inbox.rule.active", "active")})`
          : script.name;
        scriptSelect.append(option);
      }
      const activeScript = this.scripts.find((script) => { return script.active; });
      if (activeScript)
        scriptSelect.value = activeScript.name;

      modal.querySelector(".sieve-inbox-rule-connection").textContent
        = scripts.connected
          ? this.string("account.inbox.rule.connected",
            "Lint and Save validate the complete selected script on the server.")
          : this.string("account.inbox.rule.offline",
            "Connect the Sieve server before checking or saving the rule.");
      this.updateRuleActionState();
      this.renderRows();

      if (graphicalEditorLoaded)
        this.hideEditorStatus();

      // CAPABILITY and the script bodies are deliberately loaded only after
      // the selector is visible. GETSCRIPT has its own protocol timeout; an
      // additional total timeout would abandon the UI while leaving these
      // requests queued on the shared connection.
      try {
        this.ruleCapabilities
          = await this.account.send("account-capabilities") || { extensions: {} };
      } catch {
        // The generated graphical rule already enables its own requirements.
        // Capability refresh is helpful, but not required for source editing.
      }
      if (loadSequence !== this.ruleLoadSequence)
        return;

      const failures = [];
      const loadOrder = [...this.scripts].sort((left, right) => {
        return Number(!!right.active) - Number(!!left.active);
      });
      for (let index = 0; index < loadOrder.length; index++) {
        const script = loadOrder[index];
        similar.textContent = `${this.string(
          "account.inbox.rule.scripts.loading", "Loading Sieve scripts…")} `
          + `(${index + 1}/${loadOrder.length})`;
        try {
          const result = await this.account.send(
            "account-inbox-rule-script", { name: script.name });
          script.content = `${result?.content ?? ""}`;
        } catch (error) {
          failures.push({ name: script.name, error });
        }

        if (loadSequence !== this.ruleLoadSequence)
          return;
        this.updateRuleActionState();
      }

      this.updateSimilarRuleMatches();
      if (failures.length) {
        const status = modal.querySelector(".sieve-inbox-rule-similar-status");
        status.className = "form-text text-warning sieve-inbox-rule-similar-status";
        status.textContent = this.string(
          "account.inbox.rule.similar.partial",
          "Some Sieve scripts could not be inspected")
          + `: ${failures.map((failure) => { return failure.name; }).join(", ")}`;
      }
    } catch (ex) {
      if (!this.details) {
        headers.value = `${this.string(
          "account.inbox.rule.headers.error",
          "The message headers could not be loaded")}: ${ex.message || ex}`;
      }
      similar.textContent = `${this.string(
        "account.inbox.rule.similar.error",
        "The existing rules could not be checked")}: ${ex.message || ex}`;
      if (source.value && !graphicalEditorLoaded)
        this.showRuleSourceTab();
      this.setEditorStatus(`${this.string(
        "account.inbox.rule.error", "Could not open the rule editor")}: ${ex.message || ex}`,
      "danger");
    }
  }

  /**
   * Shows possible rules sharing message parameters across all server scripts.
   *
   * The result is deliberately separate from the editable snippet so saving a
   * new rule can never append an existing rule a second time.
   */
  updateSimilarRuleMatches() {
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    const container = modal.querySelector(".sieve-inbox-rule-similar");
    const status = modal.querySelector(".sieve-inbox-rule-similar-status");
    const matches = findSpamRuleMatches(this.scripts, this.details);
    const labels = {
      sender: this.string("account.spam.rule.sender", "Sender address"),
      domain: this.string("account.spam.rule.domain", "Sender domain"),
      recipient: this.string("account.spam.rule.recipient", "Recipient"),
      subject: this.string("account.spam.rule.subject", "Subject"),
      active: this.string("account.inbox.rule.active", "active"),
      line: this.string("account.spam.matches.line", "Line")
    };

    container.replaceChildren();
    const rules = matches.flatMap((result) => {
      return (result.rules || []).map((rule) => {
        return { ...rule, name: result.name, active: result.active };
      });
    });
    if (!rules.length) {
      container.textContent = this.string(
        "account.inbox.rule.similar.none",
        "No existing rule with the same email address, domain, recipient or subject was found.");
      status.className = "form-text text-success sieve-inbox-rule-similar-status";
      status.textContent = "";
      return;
    }

    for (const rule of rules) {
      const card = document.createElement("div");
      card.className = "card mb-2 sieve-inbox-rule-similar-item";

      const header = document.createElement("div");
      header.className = "card-header py-2 d-flex flex-wrap gap-2 align-items-center justify-content-between";
      const title = document.createElement("span");
      title.textContent = `${rule.name}${rule.active
        ? ` (${labels.active})` : ""} · ${labels.line} ${rule.line}`;
      const load = document.createElement("button");
      load.type = "button";
      load.className = "btn btn-sm btn-outline-primary sieve-inbox-rule-similar-load";
      load.textContent = this.string(
        "account.inbox.rule.similar.load", "Load into editor");
      load.addEventListener("click", async () => {
        try {
          await this.loadSimilarRule(rule);
        } catch (ex) {
          this.setEditorStatus(`${this.string(
            "account.inbox.rule.similar.changed",
            "The selected existing rule is no longer available")}: ${ex.message || ex}`,
          "danger");
        }
      });
      header.append(title, load);

      const source = document.createElement("textarea");
      source.className = "form-control border-0 rounded-0 font-monospace sieve-inbox-rule-similar-source";
      source.readOnly = true;
      source.spellcheck = false;
      source.wrap = "off";
      source.rows = Math.min(16, Math.max(4, rule.source.split(/\r?\n/u).length));
      source.value = rule.source;

      const criteria = document.createElement("div");
      criteria.className = "card-footer py-1 small text-body-secondary";
      criteria.textContent = rule.matches.map((match) => {
        return `${labels[match.type] || match.type}: ${match.value}`;
      }).join(" · ");
      card.append(header, source, criteria);
      container.append(card);
    }

    status.className = "form-text text-warning sieve-inbox-rule-similar-status";
    status.textContent = this.string(
      "account.inbox.rule.similar.found",
      "{count} possible similar if rule(s) were found.")
      .replace("{count}", `${rules.length}`);
  }

  /**
   * Loads one exact existing if block into the integrated editor.
   * Saving replaces this source range instead of appending a duplicate.
   *
   * @param {object} rule
   *   extracted server rule with script name and exact source range.
   */
  async loadSimilarRule(rule) {
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    const script = this.scripts.find((item) => { return item.name === rule.name; });
    if (!script || script.content.slice(rule.start, rule.end) !== rule.source) {
      throw new Error(this.string(
        "account.inbox.rule.similar.changed",
        "The selected existing rule is no longer available"));
    }

    modal.querySelector(".sieve-inbox-rule-script").value = rule.name;
    const mailboxes = getLiteralFileintoMailboxes(rule.source);
    modal.querySelector(".sieve-inbox-rule-mailbox").value = mailboxes[0] || "";
    this.editingRule = {
      name: rule.name,
      start: rule.start,
      end: rule.end,
      source: rule.source
    };
    this.lastTemplate = "";
    await this.setRuleSource(rule.source);
    this.updateRuleActionState();
    this.updateMailboxStatus();
    this.setEditorStatus(this.string(
      "account.inbox.rule.similar.loaded",
      "The existing rule from {script}, line {line}, is loaded. Save replaces exactly this rule.")
      .replace("{script}", rule.name)
      .replace("{line}", `${rule.line}`), "info");
  }

  /**
   * Replaces the editor content with a safe sender template.
   */
  async createTemplate() {
    if (!this.details)
      return;
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    try {
      this.editingRule = null;
      this.lastTemplate = createInboxRuleTemplate(
        this.details, modal.querySelector(".sieve-inbox-rule-mailbox").value);
      await this.setRuleSource(this.lastTemplate);
      this.hideEditorStatus();
      this.updateMailboxStatus();
    } catch (ex) {
      this.setEditorStatus(ex.message || `${ex}`, "danger");
    }
  }

  /**
   * Updates only an untouched generated template when its mailbox changes.
   * Freely edited rule source is never overwritten implicitly.
   */
  async updateTemplateMailbox() {
    const normalize = (source) => {
      return `${source || ""}`.replace(/\r\n?/gu, "\n").trim();
    };
    if (normalize(this.getRuleSource()) !== normalize(this.lastTemplate))
      return;
    await this.createTemplate();
  }

  /**
   * Displays existence information for literal fileinto destinations.
   */
  updateMailboxStatus() {
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    const status = inspectInboxRuleMailboxes(
      this.getRuleSource(), this.mailboxes);
    const box = modal.querySelector(".sieve-inbox-rule-mailbox-status");
    box.className = `alert alert-${status.state === "ok" ? "success" : "warning"} py-2 mt-2 mb-0 sieve-inbox-rule-mailbox-status`;

    if (status.state === "none") {
      box.textContent = this.string(
        "account.inbox.rule.mailbox.none", "The rule contains no fileinto action.");
      return;
    }
    if (status.missing.length) {
      box.textContent = `${this.string(
        "account.inbox.rule.mailbox.missing", "Mailbox not found")}: ${status.missing.join(", ")}. ${this.string(
        "account.inbox.rule.mailbox.create",
        "With :create it can be created on the first match if the server supports mailbox.")}`;
      return;
    }
    if (status.unverifiable) {
      box.textContent = this.string(
        "account.inbox.rule.mailbox.unknown", "A dynamic or multiline mailbox name cannot be checked.");
      return;
    }

    box.textContent = `${this.string(
      "account.inbox.rule.mailbox.exists", "Mailbox exists")}: ${status.existing.join(", ")}.`;
  }

  /**
   * Formats the editable rule locally.
   */
  async prettyPrintRule() {
    await this.setRuleSource(formatSieveScript(this.getRuleSource()));
    this.hideEditorStatus();
    this.updateMailboxStatus();
  }

  /**
   * Returns the save/check payload for the selected server script.
   *
   * @returns {object}
   *   IPC payload.
   */
  getRulePayload() {
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    const name = modal.querySelector(".sieve-inbox-rule-script").value;
    const script = this.scripts.find((item) => { return item.name === name; });
    if (!script)
      throw new Error("Select a Sieve script");

    const payload = {
      name,
      expected: script.content,
      snippet: this.getRuleSource()
    };
    if (this.editingRule?.name === name)
      payload.edit = { ...this.editingRule };
    return payload;
  }

  /**
   * Checks the complete resulting script on the Sieve server.
   */
  async lintRule() {
    const button = this.root.querySelector(".sieve-inbox-rule-lint");
    try {
      this.setEditorStatus(this.string(
        "account.inbox.rule.lint.running", "Checking complete script on the server…"));
      await this.account.send("account-inbox-rule-check", this.getRulePayload());
      this.setEditorStatus(this.string(
        "account.inbox.rule.lint.ok", "The complete script is valid."), "success");
      showCheckSuccess(button);
    } catch (ex) {
      this.setEditorStatus(`${this.string(
        "account.inbox.rule.lint.error", "The script is not valid")}: ${ex.message || ex}`,
      "danger");
    }
  }

  /**
   * Checks and saves the complete resulting script on the Sieve server.
   */
  async saveRule() {
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    const button = modal.querySelector(".sieve-inbox-rule-save");
    button.disabled = true;
    try {
      this.setEditorStatus(this.string(
        "account.inbox.rule.save.connecting",
        "Checking the Sieve connection before saving…"));
      await this.ensureSieveConnected();
      const payload = this.getRulePayload();
      await this.account.send("account-inbox-rule-save", payload);
      bootstrap.Modal.getOrCreateInstance(modal).hide();
      this.setStatus(`${this.string(
        "account.inbox.rule.saved", "The Sieve rule was saved in")}: ${payload.name}.`,
      "success");
    } catch (ex) {
      this.setEditorStatus(`${this.string(
        "account.inbox.rule.save.error", "Could not save the Sieve rule")}: ${ex.message || ex}`,
      "danger");
    } finally {
      button.disabled = false;
    }
  }

  /**
   * Displays a rule-editor status.
   *
   * @param {string} text
   *   status text.
   * @param {string} [style]
   *   Bootstrap alert style.
   */
  setEditorStatus(text, style = "secondary") {
    const status = this.root.querySelector(".sieve-inbox-rule-lint-status");
    status.className = `alert alert-${style} py-2 mt-2 mb-0 sieve-inbox-rule-lint-status`;
    status.textContent = text;
  }

  /** Hides and clears the rule-editor status. */
  hideEditorStatus() {
    const status = this.root.querySelector(".sieve-inbox-rule-lint-status");
    status.classList.add("d-none");
    status.textContent = "";
  }
}

export {
  formatInboxDate,
  formatInboxRuleMatches,
  SieveInboxUI,
  sortInboxMessagesByDate
};
