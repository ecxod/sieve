/*
 * Searchable spam-folder view and explicit ham restoration UI.
 */

import { SieveI18n } from "./../utils/SieveI18n.mjs";
import { matchesSpamSearch } from "./../spam/SieveSpamMessage.mjs";
import { SieveSpamContextUI } from "./SieveSpamContextUI.mjs";

/**
 * Renders one account's spam folder.
 */
class SieveSpamUI {

  /**
   * @param {SieveAccountUI} account
   *   owning account UI.
   * @param {HTMLElement} root
   *   spam tab pane.
   */
  constructor(account, root) {
    this.account = account;
    this.root = root;
    this.messages = [];
    this.selected = new Set();
    this.rendering = false;

    const search = root.querySelector(".sieve-spam-search");
    const searchLabel = root.querySelector(".sieve-spam-search-label");
    const searchId = `sieve-spam-search-${account.id}`;
    search.id = searchId;
    searchLabel.htmlFor = searchId;

    search.placeholder = this.getString(
      "account.spam.search", "Search sender, recipient or subject");
    searchLabel.textContent = this.getString(
      "account.spam.search.label", "Search spam messages");

    root.querySelector(".sieve-spam-refresh").textContent = this.getString(
      "account.spam.refresh", "Refresh");
    root.querySelector(".sieve-spam-clean").textContent = this.getString(
      "account.spam.clean", "Remove spam marking");
    root.querySelector(".sieve-spam-allow").textContent = this.getString(
      "account.spam.allow", "Permanently allow sender");
    root.querySelector(".sieve-spam-select-visible").ariaLabel = this.getString(
      "account.spam.select.visible", "Select all visible messages");

    const headings = root.querySelectorAll("thead th");
    headings[1].textContent = this.getString("account.spam.date", "Date");
    headings[2].textContent = this.getString("account.spam.sender", "Sender");
    headings[3].textContent = this.getString("account.spam.subject", "Subject");

    search.addEventListener("input", () => { this.renderRows(); });
    root.querySelector(".sieve-spam-refresh")
      .addEventListener("click", () => { this.render(); });
    root.querySelector(".sieve-spam-select-visible")
      .addEventListener("change", (event) => {
        this.selectVisible(event.currentTarget.checked);
      });
    root.querySelector(".sieve-spam-clean")
      .addEventListener("click", () => { this.cleanSelected(false); });
    root.querySelector(".sieve-spam-allow")
      .addEventListener("click", () => { this.cleanSelected(true); });

    this.context = new SieveSpamContextUI(
      account,
      root,
      (key, fallback) => { return this.getString(key, fallback); },
      (message, style) => { this.setStatus(message, style); });
  }

  /**
   * Gets a translation with an English fallback.
   *
   * @param {string} key
   *   translation key.
   * @param {string} fallback
   *   fallback value.
   * @returns {string}
   *   translated or fallback string.
   */
  getString(key, fallback) {
    try {
      return SieveI18n.getInstance().getString(key);
    } catch {
      return fallback;
    }
  }

  /**
   * Updates the live status box.
   *
   * @param {string} text
   *   status text.
   * @param {string} [style]
   *   Bootstrap alert style.
   */
  setStatus(text, style = "secondary") {
    const status = this.root.querySelector(".sieve-spam-status");
    status.className = `alert alert-${style} py-2 sieve-spam-status`;
    status.textContent = text;
  }

  /**
   * Gets rows matching the current search.
   *
   * @returns {object[]}
   *   visible messages.
   */
  getVisibleMessages() {
    const query = this.root.querySelector(".sieve-spam-search").value;
    return this.messages.filter((message) => {return matchesSpamSearch(message, query);});
  }

  /**
   * Selects or deselects every row currently visible after filtering.
   *
   * @param {boolean} selected
   *   requested selection state.
   */
  selectVisible(selected) {
    for (const message of this.getVisibleMessages()) {
      if (selected)
        this.selected.add(message.id);
      else
        this.selected.delete(message.id);
    }

    this.renderRows();
  }

  /**
   * Synchronizes the select-all checkbox and action button.
   */
  updateSelectionControls() {
    const visible = this.getVisibleMessages();
    const selectedVisible = visible.filter((message) => {return this.selected.has(message.id);});
    const selectAll = this.root.querySelector(".sieve-spam-select-visible");

    selectAll.checked = visible.length > 0 && selectedVisible.length === visible.length;
    selectAll.indeterminate = selectedVisible.length > 0
      && selectedVisible.length < visible.length;
    this.root.querySelector(".sieve-spam-clean").disabled = this.selected.size === 0;
    this.root.querySelector(".sieve-spam-allow").disabled = this.selected.size === 0;
  }

  /**
   * Draws the filtered message table using text nodes only.
   */
  renderRows() {
    const rows = this.root.querySelector(".sieve-spam-rows");
    const visible = this.getVisibleMessages();
    rows.replaceChildren();

    for (const message of visible) {
      const row = document.createElement("tr");
      const selectionCell = document.createElement("td");
      const selection = document.createElement("input");
      selection.type = "checkbox";
      selection.className = "form-check-input sieve-spam-select";
      selection.checked = this.selected.has(message.id);
      selection.setAttribute("aria-label", `${this.getString(
        "account.spam.select", "Select message")}: ${message.subject}`);
      selection.addEventListener("change", () => {
        if (selection.checked)
          this.selected.add(message.id);
        else
          this.selected.delete(message.id);
        this.updateSelectionControls();
      });
      selectionCell.append(selection);
      row.append(selectionCell);

      const date = document.createElement("td");
      date.className = "text-nowrap small";
      date.textContent = message.date
        ? new Date(message.date).toLocaleString() : "";
      row.append(date);

      const author = document.createElement("td");
      const authorText = document.createElement("span");
      authorText.className = "sieve-spam-cell-text";
      authorText.textContent = message.author;
      authorText.title = message.author;
      author.append(authorText);
      row.append(author);

      const subject = document.createElement("td");
      subject.className = "sieve-spam-subject";
      const subjectText = document.createElement("span");
      subjectText.className = "sieve-spam-cell-text";
      subjectText.textContent = message.subject
        || this.getString("account.spam.no.subject", "(No subject)");
      subjectText.title = subjectText.textContent;
      subject.append(subjectText);
      row.append(subject);

      this.context.bindRow(row, message);

      rows.append(row);
    }

    this.root.querySelector(".sieve-spam-table-wrap")
      .classList.toggle("d-none", visible.length === 0);
    this.updateSelectionControls();

    if (this.messages.length && !visible.length) {
      this.setStatus(this.getString(
        "account.spam.search.empty", "No spam messages match this search."));
    } else if (this.messages.length) {
      this.setStatus(`${visible.length} ${this.getString(
        "account.spam.visible", "of")} ${this.messages.length} ${this.getString(
        "account.spam.messages", "messages")}.`);
    }
  }

  /**
   * Loads the account's spam folder from Thunderbird.
   */
  async render() {
    if (this.rendering)
      return;

    this.rendering = true;
    this.selected.clear();
    this.context.reset();
    this.root.querySelector(".sieve-spam-table-wrap").classList.add("d-none");
    this.setStatus(this.getString(
      "account.spam.loading", "Loading spam folder…"));

    try {
      const data = await this.account.send("account-spam-list");
      this.messages = data.messages;
      this.context.setEnabled(data.contextActions === true);
      this.renderRows();

      if (data.configured === false) {
        this.setStatus(this.getString(
          "account.spam.imap.disabled",
          "Enable and configure direct IMAP access in Properties > Server."),
        "warning");
      } else if (!this.messages.length) {
        this.setStatus(`${data.folderName}: ${this.getString(
          "account.spam.empty", "No messages found.")}`, "success");
      } else if (!data.canCleanSource) {
        this.setStatus(this.getString(
          "account.spam.unsupported",
          "This Thunderbird version can move messages, but cannot permanently remove the spam prefix."),
        "warning");
      }
    } catch (ex) {
      console.error("Could not load spam folder", ex);
      this.messages = [];
      this.root.querySelector(".sieve-spam-rows").replaceChildren();
      this.setStatus(`${this.getString(
        "account.spam.error", "Could not load spam folder")}: ${ex.message || ex}`,
      "danger");
    } finally {
      this.rendering = false;
    }
  }

  /**
   * Permanently removes spam metadata from selected messages and moves the
   * cleaned copies to the inbox.
   *
   * @param {boolean} permanentAllow
   *   additionally request permanent authenticated sender allowlisting.
   */
  async cleanSelected(permanentAllow) {
    if (!this.selected.size || this.rendering)
      return;

    this.rendering = true;
    const button = this.root.querySelector(".sieve-spam-clean");
    button.disabled = true;
    this.root.querySelector(".sieve-spam-allow").disabled = true;
    this.root.querySelector(".sieve-spam-refresh").disabled = true;
    this.setStatus(this.getString(
      permanentAllow ? "account.spam.allowing" : "account.spam.cleaning",
      permanentAllow
        ? "Removing spam marking and queuing a permanent sender allowlist request…"
        : "Removing spam marking and moving to inbox…"));

    try {
      const result = await this.account.send("account-spam-unspam", {
        messageIds: [...this.selected],
        permanentAllow
      });
      this.rendering = false;
      await this.render();
      this.setStatus(`${result.processed} ${this.getString(
        permanentAllow ? "account.spam.allowed" : "account.spam.cleaned",
        permanentAllow
          ? "message(s) cleaned, queued for ham training and authenticated permanent sender allowlisting"
          : "message(s) cleaned, queued for ham training and moved to the inbox")}.`,
      "success");
    } catch (ex) {
      console.error("Could not remove spam marking", ex);
      this.setStatus(`${this.getString(
        "account.spam.clean.error", "Could not clean selected messages")}: ${ex.message || ex}`,
      "danger");
    } finally {
      this.rendering = false;
      this.root.querySelector(".sieve-spam-refresh").disabled = false;
      this.updateSelectionControls();
    }
  }
}

export { SieveSpamUI };
