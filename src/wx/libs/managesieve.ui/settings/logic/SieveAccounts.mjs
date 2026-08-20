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

/* global browser */
import { SieveAbstractAccount } from "./SieveAbstractAccount.mjs";
import { SieveAbstractAccounts } from "./SieveAbstractAccounts.mjs";
import { SievePrefManager } from "./SievePrefManager.mjs";

const CONFIG_ID_GLOBAL = "global";
const CONFIG_KEY_CUSTOM_ACCOUNTS = "custom-accounts";
const CONFIG_KEY_HIDDEN_ACCOUNTS = "hidden-accounts";
const CONFIG_KEY_IS_CUSTOM = "custom";

/**
 * Manages the configuration for sieve accounts.
 * It queries thunderbird's account and extracts all needed information.
 *
 * Global settings are stored in the addons persistence.
 */
class SieveAccounts extends SieveAbstractAccounts {

  /**
   * @inheritdoc
   */
  async load() {

    const items = await (browser.accounts.list());
    const accounts = {};
    const preferences = new SievePrefManager(CONFIG_ID_GLOBAL);
    const custom = await preferences.getComplexValue(
      CONFIG_KEY_CUSTOM_ACCOUNTS, []);

    // Thunderbird accounts are authoritative. Versions 0.6.1.21 and 0.6.1.22
    // could hide them locally after "Delete Server"; discard that obsolete
    // suppression list so every existing mail account appears automatically.
    await preferences.removeKey(CONFIG_KEY_HIDDEN_ACCOUNTS);

    for (const item of items || []) {

      if (item.type !== "imap" && item.type !== "pop3")
        continue;

      accounts[item.id] = new SieveAbstractAccount(item.id);
    }

    for (const id of custom)
      accounts[id] = new SieveAbstractAccount(id);

    this.accounts = accounts;
    return this;
  }

  /**
   * Creates and persists a custom Sieve server.
   *
   * @param {object} details
   *   display name, hostname, port and username.
   * @returns {string}
   *   the new account id.
   */
  async create(details) {
    const id = `custom-${this.generateId()}`;
    const account = new SieveAbstractAccount(id);
    const config = account.getConfig();

    await config.setBoolean(CONFIG_KEY_IS_CUSTOM, true);
    await account.getHost().setDisplayName(details.name);
    await account.getHost().setHostname(details.hostname);
    await account.getHost().setPort(details.port);
    await account.getAuthentication().setUsername(details.username);

    this.accounts[id] = account;

    const preferences = new SievePrefManager(CONFIG_ID_GLOBAL);
    const custom = await preferences.getComplexValue(
      CONFIG_KEY_CUSTOM_ACCOUNTS, []);
    custom.push(id);
    await preferences.setComplexValue(CONFIG_KEY_CUSTOM_ACCOUNTS, custom);

    return id;
  }

  /**
   * Removes a custom server. Thunderbird-derived servers are authoritative
   * and cannot be removed from the extension independently.
   *
   * @param {string} id
   *   the account id.
   * @returns {boolean}
   *   true when a custom server was removed, otherwise false.
   */
  async remove(id) {
    const account = this.accounts[id];
    if (!account)
      return false;

    const preferences = new SievePrefManager(CONFIG_ID_GLOBAL);
    const isCustom = await account.getConfig()
      .getBoolean(CONFIG_KEY_IS_CUSTOM, false);

    if (!isCustom)
      return false;

    const custom = await preferences.getComplexValue(
      CONFIG_KEY_CUSTOM_ACCOUNTS, []);
    await preferences.setComplexValue(
      CONFIG_KEY_CUSTOM_ACCOUNTS,
      custom.filter((item) => { return item !== id; }));
    await account.getConfig().clear();

    delete this.accounts[id];
    return true;
  }

}

export { SieveAccounts };
