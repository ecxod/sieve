/* global net */

const suite = net.tschmid.yautt.test;

if (!suite)
  throw new Error("Could not initialize test suite");

import {
  createSettingsBackup,
  getSettingsBackupSummary,
  parseSettingsBackup
} from "./../SieveSettingsBackup.mjs";

const EXPORTED_AT = "2026-08-24T12:00:00.000Z";
const FIRST_ITEM = 0;
const ONE_ITEM = 1;
const TWO_ITEMS = 2;
const TABULATOR_WIDTH = 4;

/** Minimal localStorage implementation for the account integration test. */
class MemoryStorage {
  /** Creates an empty store. */
  constructor() {
    this.data = new Map();
  }

  /**
   * Gets the number of stored preferences.
   *
   * @returns {number}
   *   the number of stored preferences.
   */
  get length() {
    return this.data.size;
  }

  /**
   * Gets the key stored at an index.
   *
   * @param {number} index
   *   storage index.
   * @returns {string|null}
   *   the key at the index.
   */
  key(index) {
    return [...this.data.keys()][index] ?? null;
  }

  /**
   * Gets one stored preference.
   *
   * @param {string} key
   *   storage key.
   * @returns {string|null}
   *   the stored value.
   */
  getItem(key) {
    return this.data.get(key) ?? null;
  }

  /**
   * Stores one preference.
   *
   * @param {string} key
   *   storage key.
   * @param {unknown} value
   *   value to store.
   */
  setItem(key, value) {
    this.data.set(key, `${value}`);
  }

  /**
   * Removes one stored preference.
   *
   * @param {string} key
   *   storage key.
   */
  removeItem(key) {
    this.data.delete(key);
  }
}

/**
 * Creates one representative settings backup.
 *
 * @returns {object}
 *   the portable backup.
 */
function createExample() {
  return createSettingsBackup({
    application: { sentryDsn: "" },
    global: { theme: "dark", loglevel: "0" },
    defaults: { "editor.tabulator-width": "4" },
    accounts: [
      {
        id: "account-one",
        settings: {
          "host.displayName": "Example",
          hostname: "sieve.example.test",
          port: "4190",
          "authentication.username": "user@example.test"
        },
        password: "secret"
      },
      {
        id: "account-two",
        settings: { hostname: "mail.example.test" }
      }
    ]
  }, EXPORTED_AT);
}

suite.add("Settings backup preserves portable login and editor data", function () {
  const backup = parseSettingsBackup(JSON.stringify(createExample()));

  suite.assertEquals("dark", backup.global.theme);
  suite.assertEquals("4", backup.defaults["editor.tabulator-width"]);
  suite.assertEquals("user@example.test",
    backup.accounts[0].settings["authentication.username"]);
  suite.assertEquals("secret", backup.accounts[0].password);
});

suite.add("Settings backup reports account and password counts", function () {
  const summary = getSettingsBackupSummary(createExample());

  suite.assertEquals(TWO_ITEMS, summary.accounts);
  suite.assertEquals(ONE_ITEM, summary.passwords);
});

suite.add("Settings backup rejects an unknown format or version", function () {
  const backup = createExample();

  suite.assertThrows(
    () => { parseSettingsBackup({ ...backup, format: "other" }); },
    "Not a Sieve CRAM-MD5 settings backup");
  suite.assertThrows(() => {
    parseSettingsBackup({ ...backup, version: TWO_ITEMS });
  }, "Unsupported settings backup version");
});

suite.add("Settings backup rejects duplicate account ids", function () {
  const backup = createExample();
  backup.accounts[ONE_ITEM].id = backup.accounts[0].id;

  suite.assertThrows(
    () => { parseSettingsBackup(backup); },
    "Invalid or duplicate account id");
});

suite.add("Settings backup rejects machine-bound encrypted passwords", function () {
  const backup = createExample();
  backup.accounts[0].settings["authentication.password"] = "encrypted";

  suite.assertThrows(
    () => { parseSettingsBackup(backup); },
    "Encrypted local passwords are not portable");
});

suite.add("Settings backup rejects invalid preference values", function () {
  const backup = createExample();
  backup.global.theme = { value: "dark" };

  suite.assertThrows(
    () => { parseSettingsBackup(backup); },
    "Invalid global setting theme");
});

suite.add("Global settings preserve the AMOLED and Dark Light themes", async function () {
  globalThis.localStorage = new MemoryStorage();
  globalThis.window = { addEventListener() {} };
  globalThis.frames = [];

  const { SieveAccounts } = await import("./../SieveAccounts.mjs");
  const accounts = await new SieveAccounts().load();

  await accounts.setTheme("amoled");
  suite.assertEquals("amoled", await accounts.getTheme());
  await accounts.setTheme("dark-light");
  suite.assertEquals("dark-light", await accounts.getTheme());
  await accounts.setTheme("unknown");
  suite.assertEquals("system", await accounts.getTheme());
});

suite.add("Full settings import replaces accounts and re-encrypts passwords", async function () {
  globalThis.localStorage = new MemoryStorage();
  globalThis.window = { addEventListener() {} };
  globalThis.frames = [];

  const { SieveAccounts } = await import("./../SieveAccounts.mjs");
  const accounts = await new SieveAccounts().load();
  await accounts.create({
    name: "Example",
    hostname: "sieve.example.test",
    port: "4190",
    username: "user@example.test"
  });

  const id = accounts.getAccountIds()[FIRST_ITEM];
  await accounts.setTheme("dark");
  await accounts.getEditor().setValue("tabulator-width", "4");
  await accounts.getAccountById(id).getConfig()
    .setValue("authentication.password", "machine-encrypted");

  const data = await accounts.exportAll({
    application: { sentryDsn: "" },
    includePasswords: true,
    decryptPassword: async (value) => {
      suite.assertEquals("machine-encrypted", value);
      return "portable-secret";
    }
  });

  await accounts.create({ name: "Must be removed" });
  await accounts.setTheme("light");

  const result = await accounts.importAll(data, {
    includePasswords: true,
    encryptPassword: async (value) => {
      suite.assertEquals("portable-secret", value);
      return "target-encrypted";
    }
  });

  suite.assertEquals(ONE_ITEM, accounts.getAccountIds().length);
  suite.assertEquals(id, accounts.getAccountIds()[FIRST_ITEM]);
  suite.assertEquals("dark", await accounts.getTheme());
  suite.assertEquals(TABULATOR_WIDTH,
    await accounts.getEditor().getValue("tabulator-width"));
  suite.assertEquals("target-encrypted",
    await accounts.getAccountById(id).getConfig()
      .getValue("authentication.password"));
  suite.assertEquals(ONE_ITEM, result.summary.passwords);
});
