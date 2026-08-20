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

import { SieveAbstractAuthentication } from "./SieveAbstractAuthentication.mjs";
import { SieveIpcClient } from "./../../utils/SieveIpcClient.mjs";

const CONFIG_KEY_IS_CUSTOM = "custom";
const CONFIG_KEY_USERNAME = "authentication.username";

/* global browser */

/**
 * Uses the IMAP accounts credentials.
 */
class SieveMozAuthentication extends SieveAbstractAuthentication {

  /**
   * Checks if this server was entered directly in the extension.
   *
   * @returns {boolean}
   *   true for a custom server.
   */
  async isCustom() {
    return await this.account.getConfig()
      .getBoolean(CONFIG_KEY_IS_CUSTOM, false);
  }

  /**
   * @inheritdoc
   */
  async getPassword() {
    if (await this.isCustom()) {
      const credentials = await SieveIpcClient.sendMessage(
        "accounts", "account-show-authentication", {
          username: await this.getUsername(),
          displayname: await this.account.getHost().getDisplayName()
        });

      return credentials.password;
    }

    return await browser.sieve.accounts.getPassword(this.account.getId());
  }

  /**
   * @inheritdoc
   */
  async getUsername() {
    if (await this.isCustom())
      return (await this.account.getConfig()
        .getString(CONFIG_KEY_USERNAME, "")).trim();

    return (await browser.sieve.accounts.getUsername(this.account.getId())).trim();
  }

  /**
   * Sets the username of a custom server.
   *
   * @param {string} username
   *   the authentication username.
   * @returns {SieveMozAuthentication}
   *   a self reference.
   */
  async setUsername(username) {
    await this.account.getConfig()
      .setString(CONFIG_KEY_USERNAME, `${username}`.trim());
    return this;
  }
}

export { SieveMozAuthentication as SieveAuthentication };
