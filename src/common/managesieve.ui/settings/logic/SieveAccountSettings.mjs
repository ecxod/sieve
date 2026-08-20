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

const CONFIG_DEBUG_ACCOUNT = "debug";
const CONFIG_UI_COLLAPSED = "ui-collapsed";
const DEFAULT_LOG_LEVEL = 0;

/**
 * Manages the accounts common settings.
 */
class SieveAccountSettings {

  /**
   * Creates a new instance.
   *
   * @param {SieveAccount} account
   *   a reference to the parent sieve account.
   */
  constructor(account) {
    this.account = account;
  }

  /**
   * Gets the log levels for the given account.
   *
   * @returns {int}
   *  the current log level
   */
  async getLogLevel() {
    return await this.account.getConfig()
      .getInteger(CONFIG_DEBUG_ACCOUNT, DEFAULT_LOG_LEVEL);
  }

  /**
   * Sets the log level for the given account.
   *
   * @param {int} level
   *   the new log level
   *
   * @returns {SieveAccountSettings}
   *   a self reference.
   */
  async setLogLevel(level) {
    await this.account.getConfig().setInteger(CONFIG_DEBUG_ACCOUNT, level);
    return this;
  }

  /**
   * Gets whether the server card is collapsed.
   *
   * @returns {boolean}
   *   true when only the card header should be shown
   */
  async getUiCollapsed() {
    return await this.account.getConfig()
      .getBoolean(CONFIG_UI_COLLAPSED, false);
  }

  /**
   * Persists whether the server card is collapsed.
   *
   * @param {boolean} collapsed
   *   true when only the card header should be shown
   * @returns {SieveAccountSettings}
   *   a self reference
   */
  async setUiCollapsed(collapsed) {
    await this.account.getConfig().setBoolean(CONFIG_UI_COLLAPSED, collapsed);
    return this;
  }

}

export { SieveAccountSettings };
