/*
 * The content of this file is licensed. You may obtain a copy of
 * the license at https://github.com/thsmi/sieve/ or request it via
 * email from the author.
 *
 * Do not remove or change this comment.
 */

const SETTINGS_BACKUP_FORMAT = "sieve-cram-md5-settings";
const SETTINGS_BACKUP_VERSION = 1;
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/u;
const PASSWORD_KEY = "authentication.password";
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Checks whether a value is a JSON object.
 *
 * @param {unknown} value
 *   the value to inspect.
 * @returns {boolean}
 *   true for a non-array object.
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates and copies one preference namespace.
 *
 * @param {unknown} value
 *   the preference namespace.
 * @param {string} name
 *   the name used in validation errors.
 * @returns {object}
 *   a safe copy of the namespace.
 */
function copySettings(value, name) {
  if (!isRecord(value))
    throw new Error(`Invalid ${name} settings`);

  const settings = Object.create(null);

  for (const [key, item] of Object.entries(value)) {
    if (!key || RESERVED_KEYS.has(key))
      throw new Error(`Invalid ${name} setting key`);

    if (typeof item !== "string")
      throw new Error(`Invalid ${name} setting ${key}`);

    settings[key] = item;
  }

  return settings;
}

/**
 * Parses and validates a portable application-settings backup.
 *
 * @param {string|object} data
 *   serialized or already parsed backup data.
 * @returns {object}
 *   a validated, detached backup object.
 */
function parseSettingsBackup(data) {
  if (typeof data === "string")
    data = JSON.parse(data);

  if (!isRecord(data) || data.format !== SETTINGS_BACKUP_FORMAT)
    throw new Error("Not a Sieve CRAM-MD5 settings backup");

  if (data.version !== SETTINGS_BACKUP_VERSION)
    throw new Error(`Unsupported settings backup version ${data.version}`);

  if (typeof data.exportedAt !== "string"
    || Number.isNaN(Date.parse(data.exportedAt)))
    throw new Error("Invalid settings backup date");

  const application = isRecord(data.application) ? data.application : {};
  const sentryDsn = application.sentryDsn ?? "";

  if (typeof sentryDsn !== "string")
    throw new Error("Invalid Sentry setting");

  const global = copySettings(data.global, "global");
  const defaults = copySettings(data.defaults, "default editor");

  if (Object.hasOwn(global, "accounts"))
    throw new Error("The account index may not be imported directly");

  if (!Array.isArray(data.accounts))
    throw new Error("Invalid account settings");

  const ids = new Set();
  const accounts = data.accounts.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string"
      || !ACCOUNT_ID_PATTERN.test(item.id) || ids.has(item.id))
      throw new Error("Invalid or duplicate account id");

    ids.add(item.id);

    const settings = copySettings(item.settings, `account ${item.id}`);
    if (Object.hasOwn(settings, PASSWORD_KEY))
      throw new Error("Encrypted local passwords are not portable");

    const account = { id: item.id, settings };
    if (Object.hasOwn(item, "password")) {
      if (typeof item.password !== "string")
        throw new Error(`Invalid password for account ${item.id}`);

      account.password = item.password;
    }

    return account;
  });

  return {
    format: SETTINGS_BACKUP_FORMAT,
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: data.exportedAt,
    application: { sentryDsn },
    global,
    defaults,
    accounts
  };
}

/**
 * Creates and validates a portable settings backup.
 *
 * @param {object} data
 *   application, global, default-editor and account settings.
 * @param {string} [exportedAt]
 *   optional deterministic timestamp for tests.
 * @returns {object}
 *   the validated backup.
 */
function createSettingsBackup(data, exportedAt = new Date().toISOString()) {
  return parseSettingsBackup({
    format: SETTINGS_BACKUP_FORMAT,
    version: SETTINGS_BACKUP_VERSION,
    exportedAt,
    application: data.application,
    global: data.global,
    defaults: data.defaults,
    accounts: data.accounts
  });
}

/**
 * Summarizes the user-visible contents of a backup.
 *
 * @param {string|object} data
 *   a settings backup.
 * @returns {{accounts: number, passwords: number}}
 *   account and stored-password counts.
 */
function getSettingsBackupSummary(data) {
  const backup = parseSettingsBackup(data);

  return {
    accounts: backup.accounts.length,
    passwords: backup.accounts.filter(
      (account) => { return Object.hasOwn(account, "password"); }).length
  };
}

export {
  createSettingsBackup,
  getSettingsBackupSummary,
  parseSettingsBackup,
  PASSWORD_KEY,
  SETTINGS_BACKUP_FORMAT,
  SETTINGS_BACKUP_VERSION
};
