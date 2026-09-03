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
import { SieveI18n } from "./../utils/SieveI18n.mjs";
import { SieveTemplate } from "./../utils/SieveTemplate.mjs";
import { SieveInboxUI } from "./SieveInboxUI.mjs";
import { SieveSpamUI } from "./SieveSpamUI.mjs";

import { SieveCredentialsSettingsUI } from "./../settings/ui/SieveCredentialSettingsUI.mjs";
import { SieveServerSettingsUI } from "./../settings/ui/SieveServerSettingsUI.mjs";

/**
 * A UI renderer for a sieve account
 */
class SieveNodeAccountUI extends SieveAbstractAccountUI{

  /**
   * Adds the direct-IMAP Spam tab after Properties.
   */
  async renderAccount() {
    await super.renderAccount();

    const account = document.querySelector(`#siv-account-${this.id}`);
    const spamPane = await (new SieveTemplate()).load("./accounts/account.spam.html");
    const spamPaneId = `sieve-spam-content-${this.id}`;
    spamPane.id = spamPaneId;
    account.querySelector(".sieve-account-body").append(spamPane);

    const item = document.createElement("li");
    item.className = "nav-item sieve-account-expanded";
    item.classList.toggle("d-none", account.dataset.collapsed === "true");

    const tab = document.createElement("a");
    tab.className = "sieve-spam-tab nav-link";
    tab.href = `#${spamPaneId}`;
    tab.dataset.bsToggle = "tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", spamPaneId);
    try {
      tab.textContent = SieveI18n.getInstance().getString("account.spam.tab");
    } catch {
      tab.textContent = "Spam";
    }
    item.append(tab);
    account.querySelector(".sieve-account-tabs").append(item);

    const spam = new SieveSpamUI(this, spamPane);
    tab.addEventListener("shown.bs.tab", () => { spam.render(); });

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
  }

  /**
   * Renders the settings pane
   *
   */
  async renderSettings() {

    await super.renderSettings();

    const elm = document.querySelector(`#siv-account-${this.id} .sieve-settings-content`);

    // ... finally connect the listeners.
    if (elm.querySelector(".sieve-account-delete-server")) {
      elm.querySelector(".sieve-account-delete-server")
        .addEventListener("click", () => { this.remove(); });
    }

    if (elm.querySelector(".sieve-account-edit-server")) {
      elm.querySelector(".sieve-account-edit-server")
        .addEventListener("click", () => { this.showServerSettings(); });
    }

    if (elm.querySelector(".sieve-account-edit-credentials")) {
      elm.querySelector(".sieve-account-edit-credentials")
        .addEventListener("click", () => { this.showCredentialSettings(); });
    }

    if (elm.querySelector(".sieve-account-export")) {
      elm.querySelector(".sieve-account-export")
        .addEventListener("click", () => { this.exportSettings(); });
    }

  }



  /**
   * Asks the user if he is sure to delete the account.
   * If yes it triggers expunging the account settings.
   * This can not be undone.
   */
  async remove() {
    await this.accounts.remove(this);
  }

  /**
   * Shows the server settings dialog.
   */
  async showServerSettings() {

    await (new SieveServerSettingsUI(this)).show();

    this.renderSettings();

    // Update the account name it may have changed.
    document
      .querySelector(`#siv-account-${this.id} .siv-account-name`)
      .textContent = await this.send("account-get-displayname");
  }

  /**
   * Shows the credential settings dialog.
   **/
  showCredentialSettings() {
    (new SieveCredentialsSettingsUI(this)).show();
  }

  /**
   * Exports the account's settings to a file.
   */
  async exportSettings() {
    await this.send("account-export");
  }

}

export { SieveNodeAccountUI as SieveAccountUI };
