/*
 * Context actions for messages shown in the Spam tab.
 */

/* global bootstrap */

import {
  createSpamRule,
  findSpamRuleMatches
} from "./../spam/SieveSpamRule.mjs";

/**
 * Manages the message context menu and its dialogs.
 */
class SieveSpamContextUI {

  /**
   * Creates the context-action UI.
   *
   * @param {object} account
   *   owning account UI.
   * @param {HTMLElement} root
   *   Spam pane.
   * @param {Function} getString
   *   localized string lookup.
   * @param {Function} setStatus
   *   Spam pane status callback.
   */
  constructor(account, root, getString, setStatus) {
    this.account = account;
    this.root = root;
    this.getString = getString;
    this.setStatus = setStatus;
    this.enabled = false;
    this.message = null;
    this.details = null;
    this.ruleScripts = [];
    this.ruleConnected = false;
    this.detailsCache = new Map();

    this.menu = root.querySelector(".sieve-spam-context-menu");
    this.menu.querySelector(".sieve-spam-context-show").textContent
      = this.string("account.spam.context.show", "Show headers");
    this.menu.querySelector(".sieve-spam-context-rule").textContent
      = this.string("account.spam.context.rule", "Create rule");
    this.menu.querySelector(".sieve-spam-context-search").textContent
      = this.string("account.spam.context.search", "Search in rules");

    this.menu.querySelector(".sieve-spam-context-show")
      .addEventListener("click", () => { this.showHeaders(); });
    this.menu.querySelector(".sieve-spam-context-rule")
      .addEventListener("click", () => { this.showRuleHelper(); });
    this.menu.querySelector(".sieve-spam-context-search")
      .addEventListener("click", () => { this.showRuleMatches(); });
    document.addEventListener("click", () => { this.hideMenu(); });
    window.addEventListener("blur", () => { this.hideMenu(); });

    this.initializeRuleDialog();
  }

  /**
   * Gets a translated string with a fallback.
   *
   * @param {string} key
   *   translation key.
   * @param {string} fallback
   *   fallback text.
   * @returns {string}
   *   translated text.
   */
  string(key, fallback) {
    return this.getString(key, fallback);
  }

  /**
   * Enables or disables context actions for this backend.
   *
   * @param {boolean} enabled
   *   true when message details are supported.
   */
  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled)
      this.hideMenu();
  }

  /**
   * Clears details cached for a refreshed mailbox view.
   */
  reset() {
    this.detailsCache.clear();
    this.message = null;
    this.details = null;
    this.hideMenu();
  }

  /**
   * Adds right-click behavior to a message row.
   *
   * @param {HTMLElement} row
   *   table row.
   * @param {object} message
   *   serialized message.
   */
  bindRow(row, message) {
    if (!this.enabled)
      return;

    row.classList.add("sieve-spam-context-row");
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.message = message;
      this.showMenu(event.clientX, event.clientY);
    });
  }

  /**
   * Opens the context menu inside the visible viewport.
   *
   * @param {number} x
   *   horizontal pointer position.
   * @param {number} y
   *   vertical pointer position.
   */
  showMenu(x, y) {
    this.menu.classList.add("show");
    this.menu.style.left = `${x}px`;
    this.menu.style.top = `${y}px`;

    const bounds = this.menu.getBoundingClientRect();
    const left = Math.max(0, Math.min(x, window.innerWidth - bounds.width));
    const top = Math.max(0, Math.min(y, window.innerHeight - bounds.height));
    this.menu.style.left = `${left}px`;
    this.menu.style.top = `${top}px`;
  }

  /**
   * Closes the context menu.
   */
  hideMenu() {
    this.menu.classList.remove("show");
  }

  /**
   * Loads details for the current message once.
   *
   * @returns {Promise<object>}
   *   message details.
   */
  async loadDetails() {
    if (!this.message)
      throw new Error("No spam message is selected");
    if (this.detailsCache.has(this.message.id))
      return this.detailsCache.get(this.message.id);

    const details = await this.account.send("account-spam-details", {
      messageId: this.message.id
    });
    this.detailsCache.set(this.message.id, details);
    return details;
  }

  /**
   * Displays the raw RFC 822 headers.
   */
  async showHeaders() {
    this.hideMenu();
    try {
      const details = await this.loadDetails();
      const modal = this.root.querySelector(".sieve-spam-headers-modal");
      modal.querySelector(".sieve-spam-headers-title").textContent
        = this.string("account.spam.headers.title", "Message headers");
      modal.querySelector(".sieve-spam-headers").textContent = details.headers;
      bootstrap.Modal.getOrCreateInstance(modal).show();
    } catch (ex) {
      this.showError("account.spam.headers.error", "Could not load message headers", ex);
    }
  }

  /**
   * Initializes static labels and controls in the rule helper.
   */
  initializeRuleDialog() {
    const modal = this.root.querySelector(".sieve-spam-rule-modal");
    modal.querySelector(".sieve-spam-rule-title").textContent
      = this.string("account.spam.rule.title", "Create Sieve rule");
    modal.querySelector(".sieve-spam-rule-description").textContent
      = this.string("account.spam.rule.description",
        "Choose message parameters and review the generated rule before saving it.");
    modal.querySelector(".sieve-spam-rule-criteria-title").textContent
      = this.string("account.spam.rule.criteria", "Criteria");
    modal.querySelector(".sieve-spam-rule-action-label").textContent
      = this.string("account.spam.rule.action", "Action");
    modal.querySelector(".sieve-spam-rule-mailbox-label").textContent
      = this.string("account.spam.rule.mailbox", "Destination mailbox");
    modal.querySelector(".sieve-spam-rule-script-label").textContent
      = this.string("account.spam.rule.script", "Add to Sieve script");
    modal.querySelector(".sieve-spam-rule-preview-title").textContent
      = this.string("account.spam.rule.preview", "Generated Sieve rule");
    modal.querySelector('.sieve-spam-rule-action [value="fileinto"]').textContent
      = this.string("account.spam.rule.action.fileinto", "Move to mailbox");
    modal.querySelector('.sieve-spam-rule-action [value="keep"]').textContent
      = this.string("account.spam.rule.action.keep", "Keep in Inbox");
    modal.querySelector('.sieve-spam-rule-action [value="discard"]').textContent
      = this.string("account.spam.rule.action.discard", "Discard");
    modal.querySelector(".sieve-spam-rule-copy").textContent
      = this.string("account.spam.rule.copy", "Copy rule");
    modal.querySelector(".sieve-spam-rule-save").textContent
      = this.string("account.spam.rule.save", "Save and open script");

    modal.querySelectorAll("input, select").forEach((control) => {
      control.addEventListener("change", () => { this.updateRulePreview(); });
      control.addEventListener("input", () => { this.updateRulePreview(); });
    });
    modal.querySelector(".sieve-spam-rule-copy")
      .addEventListener("click", () => { this.copyRule(); });
    modal.querySelector(".sieve-spam-rule-save")
      .addEventListener("click", () => { this.saveRule(); });
  }

  /**
   * Builds one labeled criterion checkbox.
   *
   * @param {string} key
   *   criterion key.
   * @param {string} label
   *   localized label.
   * @param {string} value
   *   message value.
   * @param {boolean} checked
   *   initial state.
   * @returns {HTMLElement}
   *   checkbox wrapper.
   */
  createCriterion(key, label, value, checked) {
    const wrapper = document.createElement("div");
    wrapper.className = "form-check mb-2";
    const input = document.createElement("input");
    const id = `sieve-spam-rule-${this.account.id}-${key}`;
    input.type = "checkbox";
    input.id = id;
    input.className = "form-check-input sieve-spam-rule-criterion";
    input.dataset.criterion = key;
    input.checked = checked && !!value;
    input.disabled = !value;
    input.addEventListener("change", () => { this.updateRulePreview(); });
    const text = document.createElement("label");
    text.className = "form-check-label";
    text.htmlFor = id;
    text.textContent = value ? `${label}: ${value}` : `${label}: —`;
    wrapper.append(input, text);
    return wrapper;
  }

  /**
   * Opens the Sieve rule helper for the selected message.
   */
  async showRuleHelper() {
    this.hideMenu();
    try {
      const [details, scripts] = await Promise.all([
        this.loadDetails(),
        this.account.send("account-spam-rule-scripts")
      ]);
      this.details = details;
      this.ruleScripts = scripts.scripts || [];
      this.ruleConnected = !!scripts.connected;

      const modal = this.root.querySelector(".sieve-spam-rule-modal");
      const criteria = modal.querySelector(".sieve-spam-rule-criteria");
      criteria.replaceChildren(
        this.createCriterion("sender", this.string(
          "account.spam.rule.sender", "Sender address"), details.senderAddress, true),
        this.createCriterion("domain", this.string(
          "account.spam.rule.domain", "Sender domain"), details.senderDomain, false),
        this.createCriterion("recipient", this.string(
          "account.spam.rule.recipient", "Recipient"),
        (details.recipientAddresses || []).join(", "), false),
        this.createCriterion("subject", this.string(
          "account.spam.rule.subject", "Subject"), details.subject, false)
      );

      modal.querySelector(".sieve-spam-rule-action").value = "fileinto";
      modal.querySelector(".sieve-spam-rule-mailbox").value = "INBOX";
      const select = modal.querySelector(".sieve-spam-rule-script");
      select.replaceChildren();
      for (const script of this.ruleScripts) {
        const option = document.createElement("option");
        option.value = script.name;
        option.textContent = script.active
          ? `${script.name} (${this.string("account.spam.rule.active", "active")})`
          : script.name;
        select.append(option);
      }

      const connection = modal.querySelector(".sieve-spam-rule-connection");
      connection.textContent = scripts.connected
        ? this.string("account.spam.rule.connected", "The rule is checked by the server before saving.")
        : this.string("account.spam.rule.offline", "Connect the Sieve server to search or save rules.");
      modal.querySelector(".sieve-spam-rule-save").disabled
        = !this.ruleConnected || !this.ruleScripts.length;
      this.updateRulePreview();
      bootstrap.Modal.getOrCreateInstance(modal).show();
    } catch (ex) {
      this.showError("account.spam.rule.error", "Could not open rule helper", ex);
    }
  }

  /**
   * Reads the current rule-helper options.
   *
   * @returns {object}
   *   generator options.
   */
  getRuleOptions() {
    const modal = this.root.querySelector(".sieve-spam-rule-modal");
    return {
      criteria: [...modal.querySelectorAll(".sieve-spam-rule-criterion:checked")]
        .map((item) => { return item.dataset.criterion; }),
      action: modal.querySelector(".sieve-spam-rule-action").value,
      mailbox: modal.querySelector(".sieve-spam-rule-mailbox").value.trim()
    };
  }

  /**
   * Regenerates the preview and validates the current selection.
   */
  updateRulePreview() {
    if (!this.details)
      return;
    const modal = this.root.querySelector(".sieve-spam-rule-modal");
    const options = this.getRuleOptions();
    modal.querySelector(".sieve-spam-rule-mailbox-group")
      .classList.toggle("d-none", options.action !== "fileinto");
    try {
      const rule = createSpamRule(this.details, options);
      modal.querySelector(".sieve-spam-rule-preview").textContent = rule.sieve;
      modal.querySelector(".sieve-spam-rule-copy").disabled = false;
      modal.querySelector(".sieve-spam-rule-save").disabled
        = !this.ruleConnected || !this.ruleScripts.length;
    } catch (ex) {
      modal.querySelector(".sieve-spam-rule-preview").textContent = ex.message || `${ex}`;
      modal.querySelector(".sieve-spam-rule-copy").disabled = true;
      modal.querySelector(".sieve-spam-rule-save").disabled = true;
    }
  }

  /**
   * Copies the currently generated standalone rule.
   */
  async copyRule() {
    try {
      const rule = createSpamRule(this.details, this.getRuleOptions());
      await this.account.send("copy", rule.sieve);
      this.setStatus(this.string("account.spam.rule.copied", "Sieve rule copied."), "success");
    } catch (ex) {
      this.showError("account.spam.rule.copy.error", "Could not copy rule", ex);
    }
  }

  /**
   * Adds the generated rule to the selected server script and opens it.
   */
  async saveRule() {
    const modal = this.root.querySelector(".sieve-spam-rule-modal");
    const name = modal.querySelector(".sieve-spam-rule-script").value;
    const script = this.ruleScripts.find((item) => { return item.name === name; });
    if (!script)
      return;

    const button = modal.querySelector(".sieve-spam-rule-save");
    button.disabled = true;
    try {
      await this.account.send("account-spam-rule-save", {
        name,
        expected: script.content,
        details: this.details,
        options: this.getRuleOptions()
      });
      bootstrap.Modal.getOrCreateInstance(modal).hide();
      this.setStatus(this.string(
        "account.spam.rule.saved", "Sieve rule saved; opening the script."), "success");
      await this.account.send("script-edit", name);
    } catch (ex) {
      this.showError("account.spam.rule.save.error", "Could not save Sieve rule", ex);
    } finally {
      button.disabled = false;
    }
  }

  /**
   * Searches server scripts for parameters shared with the selected message.
   */
  async showRuleMatches() {
    this.hideMenu();
    const modal = this.root.querySelector(".sieve-spam-matches-modal");
    modal.querySelector(".sieve-spam-matches-title").textContent
      = this.string("account.spam.matches.title", "Matching Sieve rules");
    const status = modal.querySelector(".sieve-spam-matches-status");
    status.className = "alert alert-info sieve-spam-matches-status";
    status.textContent = this.string("account.spam.matches.loading", "Searching Sieve scripts…");
    modal.querySelector(".sieve-spam-matches-list").replaceChildren();
    bootstrap.Modal.getOrCreateInstance(modal).show();

    try {
      const [details, data] = await Promise.all([
        this.loadDetails(),
        this.account.send("account-spam-rule-scripts")
      ]);
      if (!data.connected) {
        status.className = "alert alert-warning sieve-spam-matches-status";
        status.textContent = this.string(
          "account.spam.matches.offline", "Connect the Sieve server before searching rules.");
        return;
      }

      const matches = findSpamRuleMatches(data.scripts || [], details);
      if (!matches.length) {
        status.textContent = this.string(
          "account.spam.matches.empty", "No rule with matching message parameters was found.");
        return;
      }

      status.className = "alert alert-success sieve-spam-matches-status";
      status.textContent = `${matches.length} ${this.string(
        "account.spam.matches.found", "matching script(s) found.")}`;
      this.renderMatches(matches);
    } catch (ex) {
      status.className = "alert alert-danger sieve-spam-matches-status";
      status.textContent = `${this.string(
        "account.spam.matches.error", "Could not search Sieve rules")}: ${ex.message || ex}`;
    }
  }

  /**
   * Renders script matches using text nodes only.
   *
   * @param {object[]} matches
   *   matching scripts.
   */
  renderMatches(matches) {
    const list = this.root.querySelector(".sieve-spam-matches-list");
    list.replaceChildren();
    const labels = {
      sender: this.string("account.spam.rule.sender", "Sender address"),
      domain: this.string("account.spam.rule.domain", "Sender domain"),
      recipient: this.string("account.spam.rule.recipient", "Recipient"),
      subject: this.string("account.spam.rule.subject", "Subject")
    };

    for (const result of matches) {
      const item = document.createElement("div");
      item.className = "list-group-item";
      const header = document.createElement("div");
      header.className = "d-flex justify-content-between align-items-center gap-2";
      const title = document.createElement("strong");
      title.textContent = result.active
        ? `${result.name} (${this.string("account.spam.rule.active", "active")})`
        : result.name;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "btn btn-sm btn-outline-primary";
      open.textContent = this.string("account.spam.matches.open", "Open script");
      open.addEventListener("click", () => {
        const modal = this.root.querySelector(".sieve-spam-matches-modal");
        bootstrap.Modal.getOrCreateInstance(modal).hide();
        this.account.send("script-edit", result.name);
      });
      header.append(title, open);
      item.append(header);

      for (const match of result.matches) {
        const label = document.createElement("div");
        label.className = "mt-2";
        label.textContent = `${labels[match.type]}: ${match.value}`;
        item.append(label);
        for (const occurrence of match.occurrences) {
          const excerpt = document.createElement("div");
          excerpt.className = "sieve-spam-match-excerpt";
          excerpt.textContent = `${this.string(
            "account.spam.matches.line", "Line")} ${occurrence.line}: ${occurrence.excerpt}`;
          item.append(excerpt);
        }
      }
      list.append(item);
    }
  }

  /**
   * Reports an action error in the Spam pane.
   *
   * @param {string} key
   *   translation key.
   * @param {string} fallback
   *   fallback message.
   * @param {Error} error
   *   underlying error.
   */
  showError(key, fallback, error) {
    console.error(fallback, error);
    this.setStatus(`${this.string(key, fallback)}: ${error.message || error}`, "danger");
  }
}

export { SieveSpamContextUI };
