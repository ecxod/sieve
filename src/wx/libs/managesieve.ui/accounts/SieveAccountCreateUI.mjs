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

/* global bootstrap */
import { SieveIpcClient } from "./../utils/SieveIpcClient.mjs";
import { SieveTemplate } from "./../utils/SieveTemplate.mjs";

/**
 * Creates a Sieve server which is independent of Thunderbird's mail accounts.
 */
class SieveAccountCreateUI {

  /**
   * Shows the create-server dialog.
   *
   * @returns {boolean}
   *   true when a server was created, otherwise false.
   */
  async show() {
    const dialog = await (new SieveTemplate())
      .load("./accounts/account.dialog.create.html");
    document.querySelector("#ctx").append(dialog);

    return await new Promise((resolve, reject) => {
      const modal = new bootstrap.Modal(dialog);
      let created = false;

      dialog.querySelector(".sieve-create-account-form")
        .addEventListener("submit", async (event) => {
          event.preventDefault();

          const account = {
            name: dialog.querySelector(".sieve-create-account-displayname").value.trim(),
            hostname: dialog.querySelector(".sieve-create-account-hostname").value.trim(),
            port: dialog.querySelector(".sieve-create-account-port").value.trim(),
            username: dialog.querySelector(".sieve-create-account-username").value.trim()
          };

          try {
            await SieveIpcClient.sendMessage("core", "account-create", account);
            created = true;
            modal.hide();
          } catch (ex) {
            reject(ex);
            modal.hide();
          }
        });

      dialog.addEventListener('hidden.bs.modal', () => {
        dialog.remove();
        resolve(created);
      });

      modal.show();
    });
  }
}

export { SieveAccountCreateUI };
