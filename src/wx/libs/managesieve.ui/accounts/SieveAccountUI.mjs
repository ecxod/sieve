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

import { SieveAbstractAccountUI } from "./SieveAbstractAccountUI.mjs";
import { SieveIpcClient } from "./../utils/SieveIpcClient.mjs";
import { SieveI18n } from "./../utils/SieveI18n.mjs";
import { SieveTemplate } from "./../utils/SieveTemplate.mjs";
import { captureException } from "./../utils/SieveSentry.mjs";
import { SieveFilterImportUI } from "./SieveFilterImportUI.mjs";
import { SieveInboxUI } from "./SieveInboxUI.mjs";
import { SieveSpamUI } from "./SieveSpamUI.mjs";


/**
 * A UI renderer for a sieve account
 */
class SieveMozAccountUI extends SieveAbstractAccountUI {

  /**
   * Adds a read-only Thunderbird-filter conversion tab to mail accounts.
   * Custom standalone Sieve servers do not have a Thunderbird filter list.
   */
  async renderAccount() {
    await super.renderAccount();

    const settings = await this.send("account-get-settings");
    if (settings.custom)
      return;

    const account = document.querySelector(`#siv-account-${this.id}`);
    const spamPane = await (new SieveTemplate()).load("./accounts/account.spam.html");
    const spamPaneId = `sieve-spam-content-${this.id}`;
    spamPane.id = spamPaneId;
    account.querySelector(".sieve-account-body").append(spamPane);

    const spamItem = document.createElement("li");
    spamItem.className = "nav-item sieve-account-expanded";
    spamItem.classList.toggle("d-none", account.dataset.collapsed === "true");

    const spamTab = document.createElement("a");
    spamTab.className = "sieve-spam-tab nav-link";
    spamTab.href = `#${spamPaneId}`;
    spamTab.dataset.bsToggle = "tab";
    spamTab.setAttribute("role", "tab");
    spamTab.setAttribute("aria-controls", spamPaneId);
    try {
      spamTab.textContent = SieveI18n.getInstance().getString("account.spam.tab");
    } catch {
      spamTab.textContent = "Spam";
    }
    spamItem.append(spamTab);
    account.querySelector(".sieve-account-tabs").append(spamItem);

    const spam = new SieveSpamUI(this, spamPane);
    spamTab.addEventListener("shown.bs.tab", () => { spam.render(); });

    const inboxPane = await (new SieveTemplate()).load("./accounts/account.inbox.html");
    const inboxPaneId = `sieve-inbox-content-${this.id}`;
    inboxPane.id = inboxPaneId;
    account.querySelector(".sieve-account-body").append(inboxPane);

    const inboxItem = document.createElement("li");
    inboxItem.className = "nav-item sieve-account-expanded";
    inboxItem.classList.toggle("d-none", account.dataset.collapsed === "true");

    const inboxTab = document.createElement("a");
    inboxTab.className = "sieve-inbox-tab nav-link";
    inboxTab.href = `#${inboxPaneId}`;
    inboxTab.dataset.bsToggle = "tab";
    inboxTab.setAttribute("role", "tab");
    inboxTab.setAttribute("aria-controls", inboxPaneId);
    try {
      inboxTab.textContent = SieveI18n.getInstance().getString("account.inbox.tab");
    } catch {
      inboxTab.textContent = "Inbox";
    }
    inboxItem.append(inboxTab);
    account.querySelector(".sieve-account-tabs").append(inboxItem);

    const inbox = new SieveInboxUI(this, inboxPane);
    inboxTab.addEventListener("shown.bs.tab", () => { inbox.render(); });

    const pane = await (new SieveTemplate()).load("./accounts/account.filters.html");
    const paneId = `sieve-filters-content-${this.id}`;
    pane.id = paneId;
    account.querySelector(".sieve-account-body").append(pane);

    const item = document.createElement("li");
    item.className = "nav-item sieve-account-expanded";
    item.classList.toggle("d-none", account.dataset.collapsed === "true");

    const tab = document.createElement("a");
    tab.className = "sieve-filters-tab nav-link";
    tab.href = `#${paneId}`;
    tab.dataset.bsToggle = "tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", paneId);
    try {
      tab.textContent = SieveI18n.getInstance().getString("account.filters.tab");
    } catch {
      tab.textContent = "Thunderbird → Sieve";
    }
    item.append(tab);
    account.querySelector(".sieve-account-tabs").append(item);

    const importer = new SieveFilterImportUI(this, pane);
    tab.addEventListener("shown.bs.tab", () => { importer.render(); });
  }

  /**
   * @inheritdoc
   */
  async renderSettings() {
    await super.renderSettings();

    const elm = document.querySelector(
      `#siv-account-${this.id} .sieve-settings-content`);
    const settings = await this.send("account-get-settings");

    elm.querySelector(".sieve-account-edit-debug")
      .classList.toggle("d-none", !settings.developer);

    if (!settings.custom) {
      elm.querySelector(".sieve-account-delete-section").remove();
      return;
    }

    elm.querySelector(".sieve-account-delete-server")
      .addEventListener("click", () => { this.remove(); });
  }

  /**
   * Removes this server configuration from the extension.
   */
  async remove() {
    await this.accounts.remove(this);
  }

  /**
   * Ensures Thunderbird reports UI/IPC connection failures and does not leave
   * the account card permanently in its connecting state.
   *
   * @returns {SieveMozAccountUI}
   *   a self reference.
   */
  async connect() {
    try {
      await super.connect();
    } catch (ex) {
      captureException(ex, {
        action: "account-connect",
        stage: "accounts-ui"
      });

      try {
        const message = ex && ex.message ? ex.message : String(ex);
        await SieveIpcClient.sendMessage(
          "accounts", "account-show-error", message);
      } catch (dialogError) {
        captureException(dialogError, {
          action: "account-show-error",
          stage: "accounts-ui"
        });
      }
    }

    return this;
  }
}

export { SieveMozAccountUI as SieveAccountUI };
