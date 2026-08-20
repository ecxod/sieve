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


import { SieveAbstractAccounts } from "./SieveAbstractAccounts.mjs";
import { SieveAccountCreateUI } from "./SieveAccountCreateUI.mjs";
import { SieveIpcClient } from "./../utils/SieveIpcClient.mjs";

/**
 * @inheritdoc
 */
class SieveWxAccounts extends SieveAbstractAccounts {

  /**
   * @inheritdoc
   */
  async render(account) {
    const create = document.querySelector("#sieve-account-create");

    if (create && create.dataset.listenerAttached !== "true") {
      create.dataset.listenerAttached = "true";
      create.addEventListener("click", async () => {
        if (await (new SieveAccountCreateUI()).show())
          await this.render();
      });
    }

    await super.render(account);
  }

  /**
   * Removes an account from the extension after confirmation.
   *
   * @param {SieveAccountUI} account
   *   the account which should be removed.
   */
  async remove(account) {
    const removed = await SieveIpcClient.sendMessage(
      "core", "account-delete", { account: account.id });

    if (removed)
      await this.render();
  }

}

export { SieveWxAccounts as SieveAccounts };
