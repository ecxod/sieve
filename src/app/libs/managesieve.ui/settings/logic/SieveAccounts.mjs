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


const JSON_INDENTATION = 2;

const CONFIG_ID_GLOBAL = "global";
const CONFIG_KEY_ACCOUNTS = "accounts";
const CONFIG_ID_DEFAULTS = "defaults";


const SETTINGS_VERSION_I = 1;

import { SieveLogger } from "./../../utils/SieveLogger.mjs";

import { SievePrefManager } from "./SievePrefManager.mjs";

import { SieveAccount } from "./SieveAccount.mjs";
import { SieveAbstractAccounts } from "./SieveAbstractAccounts.mjs";
import {
  createSettingsBackup,
  getSettingsBackupSummary,
  parseSettingsBackup,
  PASSWORD_KEY
} from "./SieveSettingsBackup.mjs";

/**
 * Manages the configuration for sieve accounts.
 * It behaves like a directory. Ist just lists the accounts.
 * The individual settings are managed by the SieveAccount object
 *
 * It uses the DOM's local store to persist the configuration data.
 */
class SieveAccounts extends SieveAbstractAccounts {

  /**
   * Reads all values in one preference namespace.
   *
   * @param {SievePrefManager} config
   *   the preference namespace.
   * @returns {object}
   *   all stored values keyed by preference name.
   */
  async readNamespace(config) {
    const settings = Object.create(null);

    for (const key of config.getKeys())
      settings[key] = await config.getValue(key);

    return settings;
  }

  /**
   * Writes all values in one preference namespace.
   *
   * @param {SievePrefManager} config
   *   the preference namespace.
   * @param {object} settings
   *   settings keyed by preference name.
   */
  async writeNamespace(config, settings) {
    for (const [key, value] of Object.entries(settings))
      await config.setValue(key, value);
  }

  /**
   * Captures the managed preferences without decrypting stored passwords.
   * This snapshot is used to roll back a failed import.
   *
   * @returns {object}
   *   the current raw configuration.
   */
  async snapshotConfiguration() {
    const global = await this.readNamespace(
      new SievePrefManager(CONFIG_ID_GLOBAL));
    delete global[CONFIG_KEY_ACCOUNTS];

    const accounts = [];
    for (const id of this.getAccountIds()) {
      accounts.push({
        id,
        settings: await this.readNamespace(new SievePrefManager(`@${id}`))
      });
    }

    return {
      global,
      defaults: await this.readNamespace(
        new SievePrefManager(CONFIG_ID_DEFAULTS)),
      accounts
    };
  }

  /**
   * Replaces every managed preference namespace with a prepared snapshot.
   *
   * @param {object} snapshot
   *   global, default-editor and account settings.
   * @param {string[]} [additionalAccountIds]
   *   additional namespaces to clear, e.g. after an interrupted replacement.
   */
  async replaceConfiguration(snapshot, additionalAccountIds = []) {
    const accountIds = new Set(this.getAccountIds());
    for (const account of snapshot.accounts)
      accountIds.add(account.id);
    for (const id of additionalAccountIds)
      accountIds.add(id);

    for (const id of accountIds)
      new SievePrefManager(`@${id}`).clear();

    const global = new SievePrefManager(CONFIG_ID_GLOBAL);
    const defaults = new SievePrefManager(CONFIG_ID_DEFAULTS);
    global.clear();
    defaults.clear();

    await this.writeNamespace(global, snapshot.global);
    await this.writeNamespace(defaults, snapshot.defaults);

    this.accounts = {};
    for (const account of snapshot.accounts) {
      await this.writeNamespace(
        new SievePrefManager(`@${account.id}`), account.settings);
      this.accounts[account.id] = new SieveAccount(account.id);
    }

    await this.save();
    SieveLogger.getInstance().level(await this.getLogLevel());
  }

  /**
   * @inheritdoc
   */
  async load() {

    const items = await (new SievePrefManager(CONFIG_ID_GLOBAL)).getComplexValue(CONFIG_KEY_ACCOUNTS, []);

    const accounts = {};

    SieveLogger.getInstance().level(await this.getLogLevel());

    if (!items)
      return this;

    for (const item of items) {
      // Recreate the accounts only when needed...
      if (this.accounts[item])
        accounts[item] = this.accounts[item];
      else
        accounts[item] = new SieveAccount(item);
    }

    this.accounts = accounts;
    return this;
  }

  /**
   * Saves the list of account configurations.
   *
   * @returns {SieveAccounts}
   *   a self reference.
   */
  async save() {
    await (new SievePrefManager(CONFIG_ID_GLOBAL)).setComplexValue(CONFIG_KEY_ACCOUNTS, [...Object.keys(this.accounts)]);
    return this;
  }

  /**
   * Creates a new account.
   * The new account will be initialized with default and then added to the list of accounts
   *
   * @param {object} [details]
   *   the accounts details like the name, hostname, port and username as key value pairs.
   *
   * @returns {SieveAccounts}
   *   a self reference.
   */
  async create(details) {

    // create a unique id;

    const id = this.generateId();

    this.accounts[id] = new SieveAccount(id);

    await this.save();

    if (typeof (details) === "undefined" || details === null)
      return this;

    if ((details.hostname !== null) && (details.hostname !== undefined))
      await (await this.accounts[id].getHost()).setHostname(details.hostname);

    if ((details.port !== null) && (details.port !== undefined))
      await (await this.accounts[id].getHost()).setPort(details.port);

    if ((details.username !== null) && (details.username !== undefined))
      await (await this.accounts[id].getAuthentication()).setUsername(details.username);

    if ((details.name !== null) && (details.name !== undefined))
      await (await this.accounts[id].getHost()).setDisplayName(details.name);

    return this;
  }

  /**
   * Removes the account including all settings.
   *
   * @param {AccountId} id
   *   the unique id which identifies the account.
   * @returns {SieveAccounts}
   *   a self reference
   */
  async remove(id) {
    // remove the accounts...
    delete this.accounts[id];
    // ... an persist it.
    await this.save();

    // remove the account's settings.
    (new SievePrefManager(`@${id}`)).clear();

    return this;
  }

  /**
   * Exports all application settings in a portable format.
   * Machine-bound encrypted passwords are decrypted only when the user has
   * explicitly chosen to include saved logins.
   *
   * @param {object} [options]
   *   export options.
   * @param {boolean} [options.includePasswords]
   *   true to include remembered passwords as portable plain text.
   * @param {Function} [options.decryptPassword]
   *   decrypts one machine-bound password.
   * @param {object} [options.application]
   *   additional application settings stored outside localStorage.
   * @returns {string}
   *   the serialized settings backup.
   */
  async exportAll(options = {}) {
    const global = await this.readNamespace(
      new SievePrefManager(CONFIG_ID_GLOBAL));
    delete global[CONFIG_KEY_ACCOUNTS];

    const accounts = [];
    for (const id of this.getAccountIds()) {
      const settings = await this.readNamespace(
        new SievePrefManager(`@${id}`));
      const account = { id, settings };

      if (Object.hasOwn(settings, PASSWORD_KEY)) {
        const encrypted = settings[PASSWORD_KEY];
        delete settings[PASSWORD_KEY];

        if (options.includePasswords !== false) {
          if (typeof options.decryptPassword !== "function")
            throw new Error("Stored passwords cannot be decrypted");

          account.password = await options.decryptPassword(encrypted);
          if (typeof account.password !== "string")
            throw new Error("Stored password could not be decrypted");
        }
      }

      accounts.push(account);
    }

    const backup = createSettingsBackup({
      application: options.application || {},
      global,
      defaults: await this.readNamespace(
        new SievePrefManager(CONFIG_ID_DEFAULTS)),
      accounts
    });

    return JSON.stringify(backup, null, JSON_INDENTATION);
  }

  /**
   * Replaces all managed settings with a portable backup. Passwords are
   * encrypted for the current operating-system user before any setting is
   * changed. A failed write restores the previous raw configuration.
   *
   * @param {string|object} data
   *   the portable settings backup.
   * @param {object} [options]
   *   import options.
   * @param {boolean} [options.includePasswords]
   *   true to import passwords contained in the backup.
   * @param {Function} [options.encryptPassword]
   *   encrypts one portable password for local storage.
   * @returns {object}
   *   the validated backup and its summary.
   */
  async importAll(data, options = {}) {
    const backup = parseSettingsBackup(data);
    const prepared = {
      global: backup.global,
      defaults: backup.defaults,
      accounts: []
    };

    for (const account of backup.accounts) {
      const settings = { ...account.settings };

      if (options.includePasswords !== false
        && Object.hasOwn(account, "password")) {
        if (typeof options.encryptPassword !== "function")
          throw new Error("Stored passwords cannot be encrypted on this system");

        const encrypted = await options.encryptPassword(account.password);
        if (typeof encrypted !== "string" || !encrypted)
          throw new Error("Stored password could not be encrypted");

        settings[PASSWORD_KEY] = encrypted;
      }

      prepared.accounts.push({ id: account.id, settings });
    }

    const previous = await this.snapshotConfiguration();

    try {
      await this.replaceConfiguration(prepared);
    } catch (ex) {
      await this.replaceConfiguration(
        previous, prepared.accounts.map((account) => { return account.id; }));
      throw ex;
    }

    return {
      backup,
      summary: getSettingsBackupSummary(backup)
    };
  }

  /**
   * Imports previously exported account settings.
   *
   * @param {string} data
   *   the settings to be imported.
   */
  async import(data) {
    data = JSON.parse(data);

    if (data.version !== SETTINGS_VERSION_I)
      throw new Error(`Unknown version ${data.version}`);

    const details = {
      name: data.settings["host.displayName"],
      hostname: data.settings["hostname"],
      port: data.settings["port"],
      username: data.settings["authentication.username"]
    };

    await this.create(details);
  }

  /**
   * Exports the account's settings.
   *
   * @param {string} id
   *   the unique account id.
   *
   * @returns {string}
   *   the account settings as json string.
   */
  async export(id) {
    const config = new SievePrefManager(`@${id}`);

    let data = {};
    for (const key of config.getKeys())
      data[key] = await (config.getValue(key));

    data = {
      "version": SETTINGS_VERSION_I,
      "settings": data
    };

    return JSON.stringify(
      data, null, JSON_INDENTATION);
  }
}

export { SieveAccounts };
