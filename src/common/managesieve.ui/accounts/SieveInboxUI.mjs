/*
 * Searchable Inbox view with an integrated Sieve rule editor.
 */

/* global bootstrap */

import { formatSieveScript } from "./../editor/text/SieveFormatter.mjs";
import {
  createInboxRuleTemplate,
  inspectInboxRuleMailboxes
} from "./../inbox/SieveInboxRule.mjs";
import { matchesSpamSearch } from "./../spam/SieveSpamMessage.mjs";
import { SieveI18n } from "./../utils/SieveI18n.mjs";

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
    this.lastTemplate = "";
    this.rendering = false;

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
    root.querySelector(".sieve-inbox-apply-latest").textContent
      = this.string("account.inbox.apply", "Run Sieve now");
    root.querySelector(".sieve-inbox-create-rule").textContent
      = this.string("account.inbox.rule.create", "Create Sieve Rule");
    const headings = root.querySelectorAll("thead th");
    headings[0].textContent = this.string("account.inbox.select.column", "Select");
    headings[1].textContent = this.string("account.inbox.date", "Date");
    headings[2].textContent = this.string("account.inbox.sender", "Sender");
    headings[3].textContent = this.string("account.inbox.subject", "Subject");

    search.addEventListener("input", () => { this.renderRows(); });
    root.querySelector(".sieve-inbox-refresh")
      .addEventListener("click", () => { this.render(); });
    root.querySelector(".sieve-inbox-apply-latest")
      .addEventListener("click", () => { this.applyLatest(); });
    root.querySelector(".sieve-inbox-create-rule")
      .addEventListener("click", () => { this.openRuleEditor(); });

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
    this.root.querySelectorAll(".sieve-inbox-select").forEach((control) => {
      control.checked = control.value === id;
    });
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
   * Applies the active server-side Sieve script to the newest Inbox message.
   *
   * The message is selected from the complete Inbox snapshot, independently
   * of the current search text. The backend revalidates its identity and does
   * not perform EXPUNGE.
   */
  async applyLatest() {
    const button = this.root.querySelector(".sieve-inbox-apply-latest");
    const newest = sortInboxMessagesByDate(this.messages)[0];
    if (!newest)
      return;

    const subject = newest.subject
      || this.string("account.inbox.no.subject", "(No subject)");
    const prompt = this.string(
      "account.inbox.apply.confirm",
      "Apply the active Sieve script to the newest Inbox message from {date} with subject “{subject}”?\n\nRules may mark the original as deleted. No EXPUNGE will be performed.")
      .replace("{date}", formatInboxDate(newest.date))
      .replace("{subject}", subject);
    if (!this.confirmApply(prompt))
      return;

    button.disabled = true;
    this.setStatus(this.string(
      "account.inbox.apply.running", "Applying the active Sieve script…"));
    try {
      const result = await this.account.send("account-inbox-apply-latest", {
        messageId: newest.id
      });
      await this.render();
      const style = result.errors ? "warning" : "success";
      this.setStatus(`${this.string(
        "account.inbox.apply.done", "Sieve was run on the newest Inbox message")}: `
        + `${result.script} (${result.filtered} ${this.string(
          "account.inbox.apply.filtered", "visible actions or reports")}, `
        + `${result.warnings} ${this.string(
          "account.inbox.apply.warnings", "warnings")}, ${result.errors} ${this.string(
          "account.inbox.apply.errors", "errors")}).`, style);
    } catch (ex) {
      this.setStatus(`${this.string(
        "account.inbox.apply.error", "Could not run Sieve")}: ${ex.message || ex}`,
      "danger");
    } finally {
      button.disabled = this.messages.length === 0;
    }
  }

  /**
   * Loads the account Inbox.
   */
  async render() {
    if (this.rendering)
      return;

    this.rendering = true;
    this.selectedId = null;
    this.root.querySelector(".sieve-inbox-create-rule").disabled = true;
    this.root.querySelector(".sieve-inbox-apply-latest").disabled = true;
    this.root.querySelector(".sieve-inbox-table-wrap").classList.add("d-none");
    this.setStatus(this.string("account.inbox.loading", "Loading Inbox…"));

    try {
      const data = await this.account.send("account-inbox-list");
      this.messages = data.messages || [];
      this.mailboxes = data.mailboxes || [];
      this.renderRows();
      this.root.querySelector(".sieve-inbox-apply-latest").disabled
        = this.messages.length === 0 || data.configured === false;

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
      = this.string("account.inbox.rule.mailbox", "Destination mailbox for template");
    modal.querySelector(".sieve-inbox-rule-source-label").textContent
      = this.string("account.inbox.rule.source", "Sieve rule");
    modal.querySelector(".sieve-inbox-rule-template").textContent
      = this.string("account.inbox.rule.template", "Create template");
    modal.querySelector(".sieve-inbox-rule-lint").textContent
      = this.string("account.inbox.rule.lint", "Lint");
    modal.querySelector(".sieve-inbox-rule-pretty").textContent
      = this.string("account.inbox.rule.pretty", "Pretty Print");
    modal.querySelector(".sieve-inbox-rule-save").textContent
      = this.string("account.inbox.rule.save", "Save");

    modal.querySelector(".sieve-inbox-rule-source")
      .addEventListener("input", () => { this.updateMailboxStatus(); });
    modal.querySelector(".sieve-inbox-rule-mailbox")
      .addEventListener("input", () => { this.updateTemplateMailbox(); });
    modal.querySelector(".sieve-inbox-rule-template")
      .addEventListener("click", () => { this.createTemplate(); });
    modal.querySelector(".sieve-inbox-rule-lint")
      .addEventListener("click", () => { this.lintRule(); });
    modal.querySelector(".sieve-inbox-rule-pretty")
      .addEventListener("click", () => { this.prettyPrintRule(); });
    modal.querySelector(".sieve-inbox-rule-save")
      .addEventListener("click", () => { this.saveRule(); });
  }

  /**
   * Opens the editor for the selected Inbox message.
   */
  async openRuleEditor() {
    if (!this.selectedId)
      return;

    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    this.setEditorStatus(this.string(
      "account.inbox.rule.loading", "Loading headers and Sieve scripts…"));

    try {
      const [details, scripts] = await Promise.all([
        this.account.send("account-inbox-details", { messageId: this.selectedId }),
        this.account.send("account-inbox-rule-scripts")
      ]);
      this.details = details;
      this.scripts = scripts.scripts || [];
      modal.querySelector(".sieve-inbox-rule-headers").value = details.headers || "";

      const scriptSelect = modal.querySelector(".sieve-inbox-rule-script");
      scriptSelect.replaceChildren();
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

      const datalist = modal.querySelector(".sieve-inbox-rule-mailboxes");
      datalist.replaceChildren();
      for (const mailbox of this.mailboxes) {
        const option = document.createElement("option");
        option.value = mailbox;
        datalist.append(option);
      }

      modal.querySelector(".sieve-inbox-rule-mailbox").value = "INBOX";
      this.lastTemplate = createInboxRuleTemplate(details, "INBOX");
      modal.querySelector(".sieve-inbox-rule-source").value = this.lastTemplate;
      modal.querySelector(".sieve-inbox-rule-connection").textContent
        = scripts.connected
          ? this.string("account.inbox.rule.connected",
            "Lint and Save validate the complete selected script on the server.")
          : this.string("account.inbox.rule.offline",
            "Connect the Sieve server before checking or saving the rule.");
      modal.querySelector(".sieve-inbox-rule-lint").disabled
        = !scripts.connected || !this.scripts.length;
      modal.querySelector(".sieve-inbox-rule-save").disabled
        = !scripts.connected || !this.scripts.length;
      this.hideEditorStatus();
      this.updateMailboxStatus();
      bootstrap.Modal.getOrCreateInstance(modal).show();
    } catch (ex) {
      this.setStatus(`${this.string(
        "account.inbox.rule.error", "Could not open the rule editor")}: ${ex.message || ex}`,
      "danger");
    }
  }

  /**
   * Replaces the editor content with a safe sender template.
   */
  createTemplate() {
    if (!this.details)
      return;
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    try {
      this.lastTemplate = createInboxRuleTemplate(
        this.details, modal.querySelector(".sieve-inbox-rule-mailbox").value);
      modal.querySelector(".sieve-inbox-rule-source").value = this.lastTemplate;
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
  updateTemplateMailbox() {
    const source = this.root.querySelector(".sieve-inbox-rule-source");
    if (source.value !== this.lastTemplate)
      return;
    this.createTemplate();
  }

  /**
   * Displays existence information for literal fileinto destinations.
   */
  updateMailboxStatus() {
    const modal = this.root.querySelector(".sieve-inbox-rule-modal");
    const status = inspectInboxRuleMailboxes(
      modal.querySelector(".sieve-inbox-rule-source").value, this.mailboxes);
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
  prettyPrintRule() {
    const source = this.root.querySelector(".sieve-inbox-rule-source");
    source.value = formatSieveScript(source.value);
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

    return {
      name,
      expected: script.content,
      snippet: modal.querySelector(".sieve-inbox-rule-source").value
    };
  }

  /**
   * Checks the complete resulting script on the Sieve server.
   */
  async lintRule() {
    try {
      this.setEditorStatus(this.string(
        "account.inbox.rule.lint.running", "Checking complete script on the server…"));
      await this.account.send("account-inbox-rule-check", this.getRulePayload());
      this.setEditorStatus(this.string(
        "account.inbox.rule.lint.ok", "The complete script is valid."), "success");
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

export { formatInboxDate, SieveInboxUI, sortInboxMessagesByDate };
