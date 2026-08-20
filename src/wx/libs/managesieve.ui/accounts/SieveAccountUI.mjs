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
import { captureException } from "./../utils/SieveSentry.mjs";


/**
 * A UI renderer for a sieve account
 */
class SieveMozAccountUI extends SieveAbstractAccountUI {

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
