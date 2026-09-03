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

const DEFAULT_AUTHORIZATION = 3;

const FIRST_ELEMENT = 0;
const BACKUP_FILE_PERMISSIONS = 0o600;

const { ipcRenderer, shell, clipboard } = require('electron');
const { init: initSentry } = require('@sentry/electron/renderer');
const { ImapFlow } = require('imapflow');

initSentry({
  sendDefaultPii: false,
  tracesSampleRate: 0
});

// Import the node modules into our global namespace...
import { SieveLogger } from "./libs/managesieve.ui/utils/SieveLogger.mjs";
import { SieveIpcClient } from "./libs/managesieve.ui/utils/SieveIpcClient.mjs";

import {
  SieveCertValidationException
} from "./libs/libManageSieve/SieveExceptions.mjs";

import { SieveSessions } from "./libs/libManageSieve/SieveSessions.mjs";

import { SieveAccounts } from "./libs/managesieve.ui/settings/logic/SieveAccounts.mjs";
import {
  getSettingsBackupSummary,
  parseSettingsBackup
} from "./libs/managesieve.ui/settings/logic/SieveSettingsBackup.mjs";

import { SieveUpdater } from "./libs/managesieve.ui/updater/SieveUpdater.mjs";
import {
  normalizeUpdateProgress
} from "./libs/managesieve.ui/updater/SieveUpdateProgress.mjs";
import { SieveTabUI } from "./libs/managesieve.ui/tabs/SieveTabsUI.mjs";

import { SieveThunderbirdProfiles } from "./libs/managesieve.ui/importer/logic/SieveThunderbirdProfile.mjs";
import { SieveAutoConfig } from "./libs/libManageSieve/SieveAutoConfig.mjs";

import { SieveI18n } from "./libs/managesieve.ui/utils/SieveI18n.mjs";
import { SieveTheme } from "./libs/managesieve.ui/utils/SieveTheme.mjs";
import {
  SieveImapSpamClient
} from "./libs/managesieve.ui/spam/SieveImapSpamClient.mjs";
import {
  SieveImapFilterClient
} from "./libs/managesieve.ui/imap/SieveImapFilterClient.mjs";
import {
  appendSpamRuleToScript,
  createSpamRule
} from "./libs/managesieve.ui/spam/SieveSpamRule.mjs";
import {
  appendInboxRuleToScript
} from "./libs/managesieve.ui/inbox/SieveInboxRule.mjs";

const IMAP_DEFAULT_PORT = 993;
const IMAP_CONNECTION_TIMEOUT = 30000;
const IMAP_GREETING_TIMEOUT = 16000;
const IMAP_SOCKET_TIMEOUT = 120000;

/**
 * Reads the optional direct-IMAP settings of an application account.
 *
 * @param {object} account
 *   application account.
 * @returns {Promise<object>}
 *   normalized IMAP settings.
 */
async function getImapSettings(account) {
  const config = account.getConfig();
  const sieveHost = await account.getHost();

  return {
    enabled: await config.getBoolean("imap.enabled", false),
    hostname: (await config.getString(
      "imap.hostname", await sieveHost.getHostname())).trim(),
    port: await config.getInteger("imap.port", IMAP_DEFAULT_PORT),
    security: await config.getString("imap.security", "tls")
  };
}

/**
 * Persists validated direct-IMAP settings.
 *
 * @param {object} account
 *   application account.
 * @param {object} settings
 *   settings received from the UI.
 */
async function setImapSettings(account, settings) {
  const enabled = !!settings.enabled;
  const hostname = `${settings.hostname || ""}`.trim();
  const port = Number.parseInt(settings.port, 10);
  const security = settings.security === "starttls" ? "starttls" : "tls";

  if (enabled && !hostname)
    throw new Error("An IMAP hostname is required");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("The IMAP port must be between 1 and 65535");

  const config = account.getConfig();
  await config.setBoolean("imap.enabled", enabled);
  await config.setString("imap.hostname", hostname);
  await config.setInteger("imap.port", port);
  await config.setString("imap.security", security);
}

/**
 * Creates an ImapFlow factory with the account's existing login.
 *
 * @param {object} account
 *   application account.
 * @param {object} settings
 *   normalized IMAP connection settings.
 * @returns {Promise<Function>}
 *   factory for authenticated ImapFlow clients.
 */
async function createImapClientFactory(account, settings) {
  const authentication = await account.getAuthentication();
  const username = await authentication.getUsername();
  const password = await authentication.getPassword();

  return () => {
    return new ImapFlow({
      host: settings.hostname,
      port: settings.port,
      secure: settings.security === "tls",
      doSTARTTLS: settings.security === "starttls",
      auth: { user: username, pass: password },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: IMAP_CONNECTION_TIMEOUT,
      greetingTimeout: IMAP_GREETING_TIMEOUT,
      socketTimeout: IMAP_SOCKET_TIMEOUT,
      clientInfo: {
        name: "Sieve Spam Manager",
        vendor: "ecxod",
        "support-url": "https://github.com/ecxod/sieve"
      }
    });
  };
}

/**
 * Creates the direct-IMAP spam adapter with the account's existing login.
 *
 * @param {object} account
 *   application account.
 * @param {object} settings
 *   normalized IMAP connection settings.
 * @returns {Promise<SieveImapSpamClient>}
 *   configured spam adapter.
 */
async function createImapSpamClient(account, settings) {
  return new SieveImapSpamClient(
    await createImapClientFactory(account, settings));
}

/**
 * Creates the direct-IMAP Sent-folder filter adapter.
 *
 * @param {object} account
 *   application account.
 * @param {object} settings
 *   normalized IMAP connection settings.
 * @returns {Promise<SieveImapFilterClient>}
 *   configured FILTER=SIEVE adapter.
 */
async function createImapFilterClient(account, settings) {
  return new SieveImapFilterClient(
    await createImapClientFactory(account, settings));
}

(async function () {
  const logger = SieveLogger.getInstance();

  await (SieveI18n.getInstance())
    .load("default", "./libs/managesieve.ui/i18n/");

  try {
    document.title = SieveI18n.getInstance().getString("title.app");
  } catch {
    document.title = "Manage Sieve Scripts";
  }

  const accounts = await (new SieveAccounts().load());
  const sessions = new SieveSessions();
  const updater = new SieveUpdater();
  let updateStatusPromise = null;
  let updateInstallProgress = { phase: "canceled" };
  let pendingSettingsBackup = null;

  ipcRenderer.on("update-install-progress", (event, progress) => {
    const normalized = normalizeUpdateProgress(progress);

    if (normalized !== null)
      updateInstallProgress = normalized;
  });

  /**
   * Shares one GitHub request between the startup notice and settings iframe.
   *
   * @param {boolean} [force]
   *   true to bypass the cached request.
   * @returns {object}
   *   normalized update status.
   */
  async function getUpdateStatus(force = false) {
    if (force || updateStatusPromise === null) {
      updateStatusPromise = updater.getStatus().catch((error) => {
        updateStatusPromise = null;
        throw error;
      });
    }

    return await updateStatusPromise;
  }

  const actions = {

    "update-check": async () => {
      return (await getUpdateStatus()).updateAvailable;
    },

    "update-status": async (msg) => {
      return await getUpdateStatus(msg.payload?.force === true);
    },

    "update-install-progress": () => {
      return updateInstallProgress;
    },

    "update-install": async () => {
      updateInstallProgress = { phase: "checking" };

      try {
        const status = await getUpdateStatus(true);

        if (!status.updateAvailable)
          throw new Error("No newer GitHub release is available");
        if (!status.installSupported || !status.installer)
          throw new Error("No verified Windows installer is available for this release");

        updateInstallProgress = normalizeUpdateProgress({
          phase: "preparing",
          received: 0,
          total: status.installer.size
        });

        if (!await (new SieveTabUI()).closeAll()) {
          updateInstallProgress = { phase: "canceled" };
          return { canceled: true };
        }

        return await ipcRenderer.invoke("install-update", status.installer);
      } catch (error) {
        updateInstallProgress = { phase: "failed" };
        throw error;
      }
    },

    "update-goto-url": () => {
      shell.openExternal('https://github.com/ecxod/sieve/releases/latest');
    },

    "update-show-settings": () => {
      document.querySelector("#settings-tab-link").click();
    },

    "import-thunderbird": function () {
      logger.logAction("Import Thunderbird accounts");
      return (new SieveThunderbirdProfiles()).getAccounts();
    },

    // account endpoints...
    "accounts-list": function () {
      logger.logAction("List Accounts");
      return accounts.getAccountIds();
    },

    "account-probe": async function (request) {
      logger.logAction("probe Account");

      const response = request;
      response.payload["port"] = await (new SieveAutoConfig(request.payload["hostname"])).detect();

      return response.payload;
    },

    "account-create": async function (msg) {
      logger.logAction("create Account");
      await accounts.create(msg.payload);

      return msg.payload;
    },

    "account-delete": async function (msg) {

      const account = msg.payload.account;
      logger.logAction(`Remove Account ${account}`);

      const host = await accounts.getAccountById(account).getHost();

      const rv = await SieveIpcClient.sendMessage(
        "accounts", "account-show-delete", await host.getDisplayName());

      if (rv)
        await accounts.remove(account);

      return rv;
    },

    "account-get-displayname": async function (msg) {
      const account = msg.payload.account;
      logger.logAction(`Get display name for ${account}`);

      const host = await accounts.getAccountById(account).getHost();
      return await host.getDisplayName();
    },

    "account-get-server": async function (msg) {

      logger.logAction(`Get server for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);
      const host = await account.getHost();

      return {
        displayName: await host.getDisplayName(),
        hostname: await host.getHostname(),
        port: await host.getPort(),
        fingerprint: await host.getFingerprint(),
        keepAlive: await host.getKeepAlive(),
        imap: await getImapSettings(account)
      };
    },

    "account-spam-list": async function (msg) {
      logger.logAction(`List IMAP spam messages for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);
      const settings = await getImapSettings(account);
      if (!settings.enabled) {
        return {
          configured: false,
          folderName: "IMAP",
          canCleanSource: true,
          messages: []
        };
      }

      const spam = await createImapSpamClient(account, settings);
      return {
        configured: true,
        contextActions: true,
        ...await spam.list()
      };
    },

    "account-spam-details": async function (msg) {
      logger.logAction(`Load IMAP spam headers for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);
      const settings = await getImapSettings(account);
      if (!settings.enabled)
        throw new Error("Direct IMAP spam management is not enabled");

      const spam = await createImapSpamClient(account, settings);
      return await spam.getDetails(msg.payload.messageId);
    },

    "account-spam-rule-scripts": async function (msg) {
      const id = msg.payload.account;
      logger.logAction(`Load scripts for Spam rule helper on ${id}`);

      if (!sessions.has(id) || !sessions.get(id).isConnected())
        return { connected: false, scripts: [] };

      const session = sessions.get(id);
      const scripts = [];
      for (const item of await session.listScripts()) {
        scripts.push({
          name: item.script,
          active: !!item.active,
          content: await session.getScript(item.script)
        });
      }
      return { connected: true, scripts };
    },

    "account-spam-rule-save": async function (msg) {
      const id = msg.payload.account;
      const name = `${msg.payload.name || ""}`;
      logger.logAction(`Save Spam rule to ${name} on ${id}`);

      if (!sessions.has(id) || !sessions.get(id).isConnected())
        throw new Error("The Sieve server is not connected");
      if ((new SieveTabUI()).has(id, name))
        throw new Error("Close the open editor for this script before changing it");

      const session = sessions.get(id);
      const current = await session.getScript(name);
      if (current !== msg.payload.expected)
        throw new Error("The server script changed; reopen the rule helper and try again");

      const rule = createSpamRule(msg.payload.details || {}, msg.payload.options || {});
      const updated = appendSpamRuleToScript(current, rule);
      await session.checkScript(updated);
      await session.putScript(name, updated);

      return { name, ruleId: rule.id };
    },

    "account-spam-unspam": async function (msg) {
      logger.logAction(`Restore IMAP spam messages for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);
      const settings = await getImapSettings(account);
      if (!settings.enabled)
        throw new Error("Direct IMAP spam management is not enabled");

      const messageIds = Array.isArray(msg.payload.messageIds)
        ? msg.payload.messageIds : [];
      if (!messageIds.length)
        return { processed: 0 };

      const spam = await createImapSpamClient(account, settings);
      return await spam.unspam(messageIds, !!msg.payload.permanentAllow);
    },

    "account-inbox-list": async function (msg) {
      logger.logAction(`List IMAP Inbox messages for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);
      const settings = await getImapSettings(account);
      if (!settings.enabled) {
        return {
          configured: false,
          folderName: "IMAP",
          mailboxes: [],
          messages: []
        };
      }

      const inbox = await createImapSpamClient(account, settings);
      return {
        configured: true,
        ...await inbox.listInbox()
      };
    },

    "account-inbox-details": async function (msg) {
      logger.logAction(`Load IMAP Inbox headers for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);
      const settings = await getImapSettings(account);
      if (!settings.enabled)
        throw new Error("Direct IMAP Inbox access is not enabled");

      const inbox = await createImapSpamClient(account, settings);
      return await inbox.getInboxDetails(msg.payload.messageId);
    },

    "account-inbox-apply-latest": async function (msg) {
      const id = msg.payload.account;
      logger.logAction(`Apply active Sieve script to newest Inbox message on ${id}`);

      if (!sessions.has(id) || !sessions.get(id).isConnected())
        throw new Error("Connect the Sieve server before running its rules");

      const active = (await sessions.get(id).listScripts())
        .find((script) => { return !!script.active; });
      if (!active)
        throw new Error("The Sieve server has no active script");

      const account = accounts.getAccountById(id);
      const settings = await getImapSettings(account);
      if (!settings.enabled)
        throw new Error("Direct IMAP Inbox access is not enabled");

      const filter = await createImapFilterClient(account, settings);
      const snapshot = await filter.prepareInbox(msg.payload.messageId);
      const result = await filter.apply(active.script, snapshot);
      return {
        ...result,
        folder: snapshot.folder,
        script: active.script
      };
    },

    "account-inbox-rule-scripts": async function (msg) {
      const id = msg.payload.account;
      logger.logAction(`Load scripts for Inbox rule editor on ${id}`);

      if (!sessions.has(id) || !sessions.get(id).isConnected())
        return { connected: false, scripts: [] };

      const session = sessions.get(id);
      const scripts = [];
      for (const item of await session.listScripts()) {
        scripts.push({
          name: item.script,
          active: !!item.active,
          content: await session.getScript(item.script)
        });
      }
      return { connected: true, scripts };
    },

    "account-inbox-rule-check": async function (msg) {
      const id = msg.payload.account;
      const name = `${msg.payload.name || ""}`;
      logger.logAction(`Check Inbox rule for ${name} on ${id}`);

      if (!sessions.has(id) || !sessions.get(id).isConnected())
        throw new Error("The Sieve server is not connected");

      const session = sessions.get(id);
      const current = await session.getScript(name);
      if (current !== msg.payload.expected)
        throw new Error("The server script changed; reopen the Inbox rule editor");

      await session.checkScript(
        appendInboxRuleToScript(current, msg.payload.snippet));
      return { valid: true };
    },

    "account-inbox-rule-save": async function (msg) {
      const id = msg.payload.account;
      const name = `${msg.payload.name || ""}`;
      logger.logAction(`Save Inbox rule to ${name} on ${id}`);

      if (!sessions.has(id) || !sessions.get(id).isConnected())
        throw new Error("The Sieve server is not connected");
      if ((new SieveTabUI()).has(id, name))
        throw new Error("Close the open editor for this script before changing it");

      const session = sessions.get(id);
      const current = await session.getScript(name);
      if (current !== msg.payload.expected)
        throw new Error("The server script changed; reopen the Inbox rule editor");

      const updated = appendInboxRuleToScript(current, msg.payload.snippet);
      await session.checkScript(updated);
      await session.putScript(name, updated);
      return { name };
    },

    "account-get-settings": async function (msg) {

      logger.logAction(`Get settings for ${msg.payload.account}`);

      // for the settings menu
      const account = accounts.getAccountById(msg.payload.account);
      const host = await account.getHost();
      const authentication = await account.getAuthentication();
      const security = await account.getSecurity();

      return {
        displayName: await host.getDisplayName(),
        hostname: await host.getHostname(),
        port: await host.getPort(),
        fingerprint: await host.getFingerprint(),

        security: await security.getTLS(),

        mechanism: await security.getMechanism(),
        username: await authentication.getUsername()
      };
    },

    "settings-get-loglevel": async function () {
      return await accounts.getLogLevel();
    },

    "settings-get-theme": async function () {
      return await accounts.getTheme();
    },

    "settings-set-theme": async function (msg) {
      await accounts.setTheme(msg.payload.theme);
      SieveTheme.broadcast(window, msg.payload.theme);
    },

    "settings-get-sentry-dsn": async function () {
      return await ipcRenderer.invoke("sentry-get-dsn");
    },

    "settings-set-sentry-dsn": async function (msg) {
      return await ipcRenderer.invoke("sentry-set-dsn", msg.payload.dsn);
    },

    "settings-backup-export": async function (msg) {
      logger.logAction("Export all application settings");

      const date = new Date().toISOString().slice(0, "YYYY-MM-DD".length);
      const options = {
        title: "Export Sieve Settings",
        defaultPath: `sieve-settings-${date}.json`,
        filters: [
          { name: "Sieve Settings Backup", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] }]
      };
      const filename = await ipcRenderer.invoke("save-dialog", options);

      if (filename.canceled)
        return { canceled: true };

      const data = await accounts.exportAll({
        includePasswords: msg.payload.includePasswords,
        application: {
          sentryDsn: await ipcRenderer.invoke("sentry-get-dsn")
        },
        decryptPassword: async (password) => {
          return await ipcRenderer.invoke("decrypt-string", password);
        }
      });
      const summary = getSettingsBackupSummary(data);

      await require("fs").promises.writeFile(filename.filePath, data, {
        encoding: "utf-8",
        mode: BACKUP_FILE_PERMISSIONS
      });

      return { canceled: false, ...summary };
    },

    "settings-backup-open": async function () {
      logger.logAction("Open application settings backup");
      pendingSettingsBackup = null;

      const options = {
        title: "Import Sieve Settings",
        openFile: true,
        openDirectory: false,
        filters: [
          { name: "Sieve Settings Backup", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] }]
      };
      const filename = await ipcRenderer.invoke("open-dialog", options);

      if (filename.canceled)
        return { canceled: true };

      const data = await require("fs").promises.readFile(
        filename.filePaths[FIRST_ELEMENT], "utf-8");
      const backup = parseSettingsBackup(data);
      pendingSettingsBackup = backup;

      return {
        canceled: false,
        ...getSettingsBackupSummary(backup)
      };
    },

    "settings-backup-cancel": async function () {
      pendingSettingsBackup = null;
    },

    "settings-backup-import": async function (msg) {
      logger.logAction("Replace application settings from backup");

      if (!pendingSettingsBackup)
        throw new Error("No settings backup is awaiting confirmation");

      const backup = pendingSettingsBackup;
      pendingSettingsBackup = null;
      const includePasswords = msg.payload.includePasswords !== false;
      const summary = getSettingsBackupSummary(backup);

      if (includePasswords && summary.passwords
        && !await ipcRenderer.invoke("has-encryption"))
        throw new Error("Secure password storage is unavailable on this system");

      const previousDsn = await ipcRenderer.invoke("sentry-get-dsn");
      await ipcRenderer.invoke("sentry-set-dsn", backup.application.sentryDsn);

      try {
        for (const id of accounts.getAccountIds()) {
          if (sessions.has(id))
            await sessions.destroy(id);
        }

        await accounts.importAll(backup, {
          includePasswords,
          encryptPassword: async (password) => {
            return await ipcRenderer.invoke("encrypt-string", password);
          }
        });
      } catch (ex) {
        await ipcRenderer.invoke("sentry-set-dsn", previousDsn);
        throw ex;
      }

      return summary;
    },

    "account-settings-get-collapsed": async function (msg) {
      return await accounts.getAccountById(msg.payload.account)
        .getSettings().getUiCollapsed();
    },

    "account-settings-set-collapsed": async function (msg) {
      await accounts.getAccountById(msg.payload.account)
        .getSettings().setUiCollapsed(msg.payload.collapsed);
    },

    "account-settings-set-debug": async function (msg) {

      logger.logAction(`Set Debug Level for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);

      await account.getSettings().setLogLevel(msg.payload.levels.account);
      await accounts.setLogLevel(msg.payload.levels.global);
    },

    "account-settings-get-debug": async function (msg) {

      logger.logAction(`Get Debug Level for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);

      return {
        "account": await account.getSettings().getLogLevel(),
        "global": await accounts.getLogLevel()
      };
    },

    "account-setting-get-credentials": async function (msg) {

      logger.logAction(`Get credentials for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);

      return {
        "general": {
          security: await account.getSecurity().getTLS(),
          sasl: await account.getSecurity().getMechanism()
        },
        "authentication": {
          username: await (await account.getAuthentication()).getUsername(),
          stored: await (await account.getAuthentication()).hasStoredPassword()
        },

        "authorization": {
          type: await (await account.getAuthorization()).getType(),
          username: await (await account.getAuthorization(DEFAULT_AUTHORIZATION)).getAuthorization()
        }
      };
    },

    "account-settings-forget-credentials": async function (msg) {
      logger.logAction(`Forget credentials for ${msg.payload.account}`);

      const account = await accounts.getAccountById(msg.payload.account);
      await (await account.getAuthentication()).forget();
    },

    "account-settings-set-credentials": async function (msg) {

      logger.logAction(`Set credentials for ${msg.payload.account}`);

      const account = await accounts.getAccountById(msg.payload.account);

      await account.getSecurity().setTLS(msg.payload.general.security);
      await account.getSecurity().setMechanism(msg.payload.general.sasl);

      await account.getAuthentication().setUsername(msg.payload.authentication.username);

      await account.setAuthorization(msg.payload.authorization.mechanism);
      await (await account.getAuthorization(DEFAULT_AUTHORIZATION)).setAuthorization(msg.payload.authorization.username);
    },

    "account-set-server": async function (msg) {

      logger.logAction(`Get display server for ${msg.payload.account}`);

      const account = accounts.getAccountById(msg.payload.account);
      const host = await account.getHost();

      await host.setDisplayName(msg.payload.displayName);
      await host.setHostname(msg.payload.hostname);
      await host.setPort(msg.payload.port);

      await host.setFingerprint(msg.payload.fingerprint);

      await host.setKeepAlive(msg.payload.keepAlive);
      if (msg.payload.imap)
        await setImapSettings(account, msg.payload.imap);
    },

    "account-import": async function () {
      logger.logAction("Import account settings");

      const options = {
        title: "Import Sieve Settings",
        openFile: true,
        openDirectory: false,
        filters: [
          { name: 'Sieve Account Configuration', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }]
      };

      const filename = await ipcRenderer.invoke("open-dialog", options);

      if (filename.canceled)
        return;

      const fs = require('fs');

      if (!fs.existsSync(filename.filePaths[FIRST_ELEMENT]))
        return;

      const data = await fs.promises.readFile(filename.filePaths[FIRST_ELEMENT], "utf-8");

      await accounts.import(data);
    },

    "account-export": async function (msg) {
      logger.logAction("Export account settings");

      const host = await accounts.getAccountById(msg.payload.account).getHost();
      const name = await host.getDisplayName();

      const data = await accounts.export(msg.payload.account);


      const options = {
        title: "Export Account Settings",
        defaultPath: `${name}`,
        filters: [
          { name: 'Sieve Account Configuration', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }]
      };

      const filename = await ipcRenderer.invoke("save-dialog", options);

      // Check if the dialog was canceled...
      if (filename.canceled)
        return;

      await require('fs').promises.writeFile(filename.filePath, data, "utf-8");
    },

    "account-capabilities": async function (msg) {

      logger.logAction(`Get capabilities for ${msg.payload.account}`);

      return await (sessions.get(msg.payload.account).capabilities());
    },

    "account-connecting": async (request) => {

      logger.logAction(`Connecting ${request.payload.account}`);

      const account = request.payload.account;
      const response = request;

      try {
        const host = await accounts.getAccountById(account).getHost();

        const session = sessions.get(account);

        await (session.connect(await host.getUrl()));

        // Connection established, this means we need to listen for any
        // unplanned disconnects.
        session.on("disconnected", async () => {
          await SieveIpcClient.sendMessage("accounts", "account-disconnected", account);
        });

      } catch (e) {

        // As first step we disconnect. Our connection sequence failed.
        // So ensure the connection is closed. Anyhow we have no chance to recover.

        await (actions["account-disconnect"](response));

        if (e instanceof SieveCertValidationException) {
          const secInfo = e.getSecurityInfo();

          const rv = await SieveIpcClient.sendMessage(
            "accounts", "account-show-certerror", secInfo);

          // save the fingerprint.
          if (rv !== true)
            return;

          const host = await accounts.getAccountById(account).getHost();

          // Prefer SHA256 if available
          if ((typeof (secInfo.fingerprint256) !== "undefined") && (secInfo.fingerprint256 !== null))
            await host.setFingerprint(secInfo.fingerprint256);
          else
            await host.setFingerprint(secInfo.fingerprint);

          await host.setIgnoreCertErrors(secInfo.code);

          await actions["account-connect"](response);
          return;
        }

        // connecting failed for some reason, which means we
        // need to handle the error.
        logger.logAction("Connecting failed due to an error " + e);

        await SieveIpcClient.sendMessage(
          "accounts", "account-show-error", e.message);
      }

    },

    "account-connect": async (msg) => {

      logger.logAction(`Connect ${msg.payload.account}`);

      const accountId = msg.payload.account;

      if (sessions.has(accountId)) {
        const session = sessions.get(accountId);
        if (session.isConnected() || session.isConnecting())
          return;
      }

      const account = await accounts.getAccountById(accountId);
      await sessions.create(accountId, account);

      await actions["account-connecting"](msg);
    },

    "account-is-connecting": function(msg) {
      logger.logAction(`Is connecting ${msg.payload.account}`);

      if (!sessions.has(msg.payload.account))
        return false;

      return sessions.get(msg.payload.account).isConnecting();
    },

    "account-connected": function (msg) {
      logger.logAction(`Is connected ${msg.payload.account}`);

      if (!sessions.has(msg.payload.account))
        return false;

      return sessions.get(msg.payload.account).isConnected();
    },


    "account-disconnect": async function (msg) {
      logger.logAction(`Disconnect ${msg.payload.account}`);

      await sessions.destroy(msg.payload.account);
    },

    "account-list": async function (msg) {
      logger.logAction(`List scripts for ${msg.payload.account}`);

      return await sessions.get(msg.payload.account).listScripts();
    },

    // Script endpoint...
    "script-create": async function (msg) {
      const account = msg.payload.account;

      logger.logAction(`Create script for ${account}`);

      const name = (await SieveIpcClient.sendMessage(
        "accounts", "script-show-create", account)).trim();

      if (name !== "")
        await sessions.get(account).putScript(name, "#test\r\n");

      return name;
    },

    "script-rename": async function (msg) {
      const account = msg.payload.account;
      const oldName = msg.payload.data;

      logger.logAction(`Rename Script ${oldName} for account: ${account}`);

      if ((new SieveTabUI()).has(account, oldName)) {
        await SieveIpcClient.sendMessage("accounts", "script-show-busy", oldName);
        return false;
      }

      const newName = (await SieveIpcClient.sendMessage(
        "accounts", "script-show-rename", oldName)).trim();

      if (newName === oldName)
        return false;

      await sessions.get(account).renameScript(oldName, newName);
      return true;
    },

    "script-delete": async function (msg) {
      const account = msg.payload.account;
      const name = msg.payload.data;

      logger.logAction(`Delete Script ${name} for account: ${account}`);

      if ((await sessions.get(account).listScripts())
        .some((script) => { return script.script === name && script.active; }))
        return false;

      if ((new SieveTabUI()).has(account, name)) {
        await SieveIpcClient.sendMessage("accounts", "script-show-busy", name);
        return false;
      }

      const rv = await SieveIpcClient.sendMessage("accounts", "script-show-delete", name, window.frames);

      if (rv === true)
        await sessions.get(account).deleteScript(name);

      return rv;
    },

    "script-apply-sent": async function (msg) {
      const accountId = msg.payload.account;
      const name = msg.payload.data;

      logger.logAction(`Apply Script ${name} to Sent for account: ${accountId}`);

      try {
        const account = accounts.getAccountById(accountId);
        const settings = await getImapSettings(account);
        if (!settings.enabled)
          throw new Error("Direct IMAP access is not enabled for this account");

        const scripts = await sessions.get(accountId).listScripts();
        if (!scripts.some((script) => { return script.script === name; }))
          throw new Error("The selected Sieve script no longer exists");

        const filter = await createImapFilterClient(account, settings);
        const snapshot = await filter.prepare();
        const confirmed = await SieveIpcClient.sendMessage(
          "accounts", "script-show-apply-sent", {
            name,
            folder: snapshot.folder,
            messages: snapshot.uids.length
          });

        if (!confirmed)
          return { canceled: true };

        const result = await filter.apply(name, snapshot);
        await SieveIpcClient.sendMessage(
          "accounts", "script-show-apply-sent-result", result);
        return result;
      } catch (ex) {
        await SieveIpcClient.sendMessage(
          "accounts", "account-show-error", ex.message || `${ex}`);
        return { error: true };
      }
    },

    "script-activate": async function (msg) {
      const account = msg.payload.account;
      const name = msg.payload.data;

      logger.logAction(`Activate ${name} for ${account}`);

      await sessions.get(account).activateScript(name);
    },

    "script-deactivate": async function (msg) {
      const account = msg.payload.account;

      logger.logAction(`Deactivate script for ${account}`);

      await sessions.get(account).activateScript();
    },

    "script-edit": async function (msg) {

      const name = msg.payload.data;
      const account = msg.payload.account;

      logger.logAction(`Edit ${name} on ${account}`);

      await (new SieveTabUI()).open(account, name);
    },

    "script-get": async function (msg) {

      const name = msg.payload.data;
      const account = msg.payload.account;

      logger.logAction(`Get ${name} for ${account}`);

      return await sessions.get(account).getScript(name);
    },

    "script-check": async function (msg) {
      const account = msg.payload.account;
      const script = msg.payload.data;

      logger.logAction(`Check Script for ${account}`);

      try {
        return await sessions.get(account).checkScript(script);
      }
      catch (ex) {
        // TODO throw an exception in case is it not an instance of a server side exception...
        return ex.getResponse().getMessage();
      }
    },

    "script-save": async function (msg) {
      const account = msg.payload.account;
      const name = msg.payload.name;
      const script = msg.payload.script;

      logger.logAction(`Save ${name} for ${account}`);

      await sessions.get(account).putScript(name, script);
    },

    "script-import": async function () {
      logger.logAction("Import Script");

      const options = {
        title: "Import Script",
        openFile: true,
        openDirectory: false,
        filters: [
          { name: 'Sieve Scripts', extensions: ['siv', "sieve"] },
          { name: 'All Files', extensions: ['*'] }]
      };

      const filename = await ipcRenderer.invoke("open-dialog", options);

      if (filename.canceled)
        return undefined;

      const fs = require('fs');

      if (!fs.existsSync(filename.filePaths[FIRST_ELEMENT]))
        return undefined;

      return await fs.promises.readFile(filename.filePaths[FIRST_ELEMENT], "utf-8");
    },

    "script-export": async function (request) {
      logger.logAction("Export Script");

      const script = request.payload.script;

      const options = {
        title: "Export Script",
        defaultPath: request.payload.name,
        filters: [
          { name: 'Sieve Scripts', extensions: ['siv', "sieve"] },
          { name: 'All Files', extensions: ['*'] }]
      };

      const filename = await ipcRenderer.invoke("save-dialog", options);

      // Check if the dialog was canceled...
      if (filename.canceled)
        return;

      await require('fs').promises.writeFile(filename.filePath, script, "utf-8");
    },

    "copy": function (msg) {
      clipboard.writeText(msg.payload.data);
    },

    "paste": function () {
      return clipboard.readText();
    },

    "get-preference": async (msg) => {

      const name = msg.payload.data;
      const account = msg.payload.account;

      logger.logAction(`Set value ${name} on ${account}`);

      const value = await accounts.getAccountById(account).getEditor().getValue(name);

      if (value === null)
        return await actions["get-default-preference"](msg);

      return value;
    },

    "get-default-preference": async (msg) => {
      const name = msg.payload.data;

      logger.logAction(`Get default value for ${name}`);

      return await accounts.getEditor().getValue(name);
    },

    "set-preference": async (msg) => {
      const name = msg.payload.key;
      const value = msg.payload.value;
      const account = msg.payload.account;

      logger.logAction(`Set value ${name} on ${account}`);

      await accounts.getAccountById(account).getEditor().setValue(name, value);
    },

    "set-default-preference": async (msg) => {
      const name = msg.payload.key;
      const value = msg.payload.value;

      logger.logAction(`Set default value for ${name}`);

      await accounts.getEditor().setValue(name, value);
    },

    "open-developer-tools": async() => {
      await ipcRenderer.invoke("open-developer-tools");
    },

    "reload-ui" : async() => {
      await ipcRenderer.invoke("reload-ui");
    },

    "has-encryption" : async() => {
      return await ipcRenderer.invoke("has-encryption");
    },

    "encrypt-string" : async(msg) => {
      return await ipcRenderer.invoke("encrypt-string", msg.payload);
    },

    "decrypt-string" : async(msg) => {
      return await ipcRenderer.invoke("decrypt-string", msg.payload);
    }
  };

  for (const [key, value] of Object.entries(actions)) {
    SieveIpcClient.setRequestHandler("core", key, value);
  }


  /**
   * The main entry point
   * Called as soon as the DOM is ready.
   */
  async function main() {
    SieveTheme.init(await accounts.getTheme());

    document.querySelector("#settings-tab-label").textContent
      = SieveI18n.getInstance().getString("account.settings");

    document.querySelector("#sieve-fork-version").textContent
      = await ipcRenderer.invoke("get-version");

    (new SieveTabUI()).init();
  }

  if (document.readyState !== 'loading')
    main();
  else
    document.addEventListener('DOMContentLoaded', () => { main(); }, { once: true });

})();
