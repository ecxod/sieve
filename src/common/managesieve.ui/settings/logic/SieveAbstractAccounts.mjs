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


const CONFIG_ID_GLOBAL = "global";
const CONFIG_KEY_LOG_LEVEL = "loglevel";
const CONFIG_KEY_THEME = "theme";
const CONFIG_KEY_DEVELOPER = "developer";

const DEFAULT_LOG_LEVEL = 0;
const DEFAULT_THEME = "system";
const THEMES = ["system", "light", "dark"];

import { SieveUniqueId } from "./../../utils/SieveUniqueId.mjs";
import { SievePrefManager } from "./SievePrefManager.mjs";
import { SieveEditorSettings } from "./SieveEditorSettings.mjs";

/**
 * Abstract class which manages sieve accounts.
 */
class SieveAbstractAccounts {

  /**
   * Creates a new instance
   */
  constructor() {
    this.accounts = {};
  }

  /**
   * Loads the list of accounts configurations.
   * @abstract
   *
   * @returns {SieveAccounts}
   *   a self reference.
   */
  async load() {
    throw new Error("Implement me");
  }

  /**
   * Generates a pseudo unique id.
   * The id is guaranteed to be made of alphanumerical characters and dashes.
   *
   * @returns {string}
   *   the unique id in string representation.
   */
  generateId() {
    return (new SieveUniqueId()).generate();
  }

  /**
   * Returns a list with all accounts.
   * The accounts are returned as key value pairs (unique id and Account)
   *
   * @returns { Object<string, SieveAccount>}
   *   a list with sieve account.
   */
  getAccountIds() {
    return Object.keys(this.accounts);
  }

  /**
   * Returns a specific sieve account
   * @param {string} id
   *   the accounts unique id.
   * @returns {SieveAccount}
   *   the sieve account or undefined.
   */
  getAccountById(id) {
    return this.accounts[id];
  }

  /**
   * Sets the global log level.
   *
   * @param {int} level
   *   the global log level as integer.
   * @returns {SieveAccounts}
   *   a self reference.
   */
  async setLogLevel(level) {
    await (new SievePrefManager(CONFIG_ID_GLOBAL)).setInteger(CONFIG_KEY_LOG_LEVEL, level);
    return this;
  }

  /**
   * Gets the global log level.
   *
   * @returns {int}
   *   the log level as integer.
   */
  async getLogLevel() {
    return await (new SievePrefManager(CONFIG_ID_GLOBAL))
      .getInteger(CONFIG_KEY_LOG_LEVEL, DEFAULT_LOG_LEVEL);
  }

  /**
   * Sets the global application color theme.
   *
   * @param {string} theme
   *   system, light or dark
   * @returns {SieveAccounts}
   *   a self reference
   */
  async setTheme(theme) {
    if (!THEMES.includes(theme))
      theme = DEFAULT_THEME;

    await (new SievePrefManager(CONFIG_ID_GLOBAL)).setString(CONFIG_KEY_THEME, theme);
    return this;
  }

  /**
   * Gets the global application color theme.
   *
   * @returns {string}
   *   system, light or dark
   */
  async getTheme() {
    const theme = await (new SievePrefManager(CONFIG_ID_GLOBAL))
      .getString(CONFIG_KEY_THEME, DEFAULT_THEME);

    if (!THEMES.includes(theme))
      return DEFAULT_THEME;

    return theme;
  }

  /**
   * Enables or disables developer-only controls.
   *
   * @param {boolean} developer
   *   true to show developer controls.
   * @returns {SieveAccounts}
   *   a self reference.
   */
  async setDeveloper(developer) {
    await (new SievePrefManager(CONFIG_ID_GLOBAL))
      .setBoolean(CONFIG_KEY_DEVELOPER, developer);
    return this;
  }

  /**
   * Checks whether developer-only controls are enabled.
   *
   * @returns {boolean}
   *   true when developer controls should be shown.
   */
  async getDeveloper() {
    return await (new SievePrefManager(CONFIG_ID_GLOBAL))
      .getBoolean(CONFIG_KEY_DEVELOPER, false);
  }

  /**
   * Gets the object managing the editor's default settings.
   *
   * @returns {SieveEditorSettings}
   *   the settings object
   */
  getEditor() {
    return new SieveEditorSettings(new SievePrefManager("defaults"));
  }

}

export { SieveAbstractAccounts };
