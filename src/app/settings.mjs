/*
 * The content of this file is licensed. You may obtain a copy of
 * the license at https://github.com/thsmi/sieve/ or request it via
 * email from the author.
 *
 * Do not remove or change this comment.
 */

/* global bootstrap */

const SETTINGS_RELOAD_DELAY_MS = 750;

import { SieveI18n } from "./libs/managesieve.ui/utils/SieveI18n.mjs";
import { SieveIpcClient } from "./libs/managesieve.ui/utils/SieveIpcClient.mjs";
import { SieveTemplate } from "./libs/managesieve.ui/utils/SieveTemplate.mjs";
import { SieveTheme } from "./libs/managesieve.ui/utils/SieveTheme.mjs";

/**
 * Initializes the global application settings page.
 */
async function main() {
  const themePreference = await SieveIpcClient.sendMessage("core", "settings-get-theme");
  SieveTheme.init(themePreference);

  await SieveI18n.getInstance().load(
    "default", "./libs/managesieve.ui/i18n/");
  document.title = SieveI18n.getInstance().getString("account.settings");

  document.querySelector(".siv-settings").append(
    await (new SieveTemplate()).load("./libs/managesieve.ui/settings/settings.html"));

  const theme = document.querySelector("#sieve-theme");
  theme.value = themePreference;
  theme.addEventListener("change", async () => {
    SieveTheme.apply(theme.value);
    await SieveIpcClient.sendMessage("core", "settings-set-theme", {
      theme: theme.value
    });
  });

  const i18n = SieveI18n.getInstance();
  const updateCurrent = document.querySelector("#sieve-update-current-version");
  const updateLatest = document.querySelector("#sieve-update-latest-version");
  const updateMessage = document.querySelector("#sieve-update-status");
  const updateCheck = document.querySelector("#sieve-update-check");
  const updateInstall = document.querySelector("#sieve-update-install");
  const updateRelease = document.querySelector("#sieve-update-release");
  let updateStatus = null;

  /**
   * Shows a localized update status.
   *
   * @param {string} message
   *   localized message.
   * @param {string} [style]
   *   Bootstrap text color suffix.
   */
  function showUpdateMessage(message, style = "body-secondary") {
    updateMessage.classList.remove(
      "text-body-secondary", "text-success", "text-warning", "text-danger");
    updateMessage.classList.add(`text-${style}`);
    updateMessage.textContent = message;
  }

  /**
   * Refreshes installed and published release information.
   */
  async function refreshUpdateStatus(force = false) {
    updateCheck.disabled = true;
    updateInstall.disabled = true;
    updateInstall.classList.add("d-none");
    updateRelease.classList.add("d-none");
    showUpdateMessage(i18n.getString("settings.update.checking"));

    try {
      updateStatus = await SieveIpcClient.sendMessage(
        "core", "update-status", { force });
      updateCurrent.textContent = updateStatus.currentVersion;
      updateLatest.textContent = updateStatus.latestVersion;
      updateRelease.classList.remove("d-none");

      if (!updateStatus.updateAvailable) {
        showUpdateMessage(i18n.getString("settings.update.currentStatus"), "success");
        return;
      }

      if (updateStatus.installSupported) {
        updateInstall.classList.remove("d-none");
        updateInstall.disabled = false;
        showUpdateMessage(i18n.getString("settings.update.available"), "warning");
        return;
      }

      const reason = updateStatus.platform === "win32"
        ? "settings.update.noInstaller"
        : "settings.update.unsupported";
      showUpdateMessage(
        `${i18n.getString("settings.update.available")} ${i18n.getString(reason)}`,
        "warning");
    } catch (error) {
      updateStatus = null;
      showUpdateMessage(
        `${i18n.getString("settings.update.failed")} ${error?.message || error}`,
        "danger");
    } finally {
      updateCheck.disabled = false;
    }
  }

  updateCheck.addEventListener("click", async () => {
    await refreshUpdateStatus(true);
  });
  updateRelease.addEventListener("click", async () => {
    await SieveIpcClient.sendMessage("core", "update-goto-url");
  });
  updateInstall.addEventListener("click", async () => {
    updateCheck.disabled = true;
    updateInstall.disabled = true;
    showUpdateMessage(i18n.getString("settings.update.installing"), "warning");

    try {
      const result = await SieveIpcClient.sendMessage("core", "update-install");

      if (result.canceled) {
        showUpdateMessage(i18n.getString("settings.update.canceled"), "warning");
        updateInstall.disabled = false;
        return;
      }

      showUpdateMessage(i18n.getString("settings.update.started"), "success");
    } catch (error) {
      showUpdateMessage(
        `${i18n.getString("settings.update.failed")} ${error?.message || error}`,
        "danger");
      updateInstall.disabled = false;
    } finally {
      updateCheck.disabled = false;
    }
  });

  await refreshUpdateStatus();

  const sentryDsn = document.querySelector("#sieve-sentry-dsn");
  const sentryStatus = document.querySelector("#sieve-sentry-status");

  sentryDsn.value = await SieveIpcClient.sendMessage(
    "core", "settings-get-sentry-dsn");

  document.querySelector("#sieve-sentry-save")
    .addEventListener("click", async () => {
      sentryDsn.value = sentryDsn.value.trim();
      sentryStatus.classList.remove("text-success", "text-danger");

      try {
        await SieveIpcClient.sendMessage(
          "core", "settings-set-sentry-dsn", { dsn: sentryDsn.value });
        sentryStatus.classList.add("text-success");
        sentryStatus.textContent = i18n.getString("settings.sentry.saved");
      } catch {
        sentryStatus.classList.add("text-danger");
        sentryStatus.textContent = i18n.getString("settings.sentry.invalid");
      }
    });

  const backupStatus = document.querySelector("#sieve-settings-backup-status");
  const exportButton = document.querySelector("#sieve-settings-backup-export");
  const importButton = document.querySelector("#sieve-settings-backup-import");
  const importAccept = document.querySelector("#sieve-settings-import-accept");
  const exportPasswords = document.querySelector("#sieve-settings-backup-passwords");
  const importPasswords = document.querySelector("#sieve-settings-import-passwords");
  const importDialog = new bootstrap.Modal(
    document.querySelector("#sieve-settings-import-dialog"));
  let pendingBackup = null;
  let importInProgress = false;

  /**
   * Shows the result of a backup operation.
   *
   * @param {string} message
   *   the localized status text.
   * @param {boolean} [failed]
   *   true for an error status.
   */
  function showBackupStatus(message, failed = false) {
    backupStatus.classList.remove("text-success", "text-danger");
    backupStatus.classList.add(failed ? "text-danger" : "text-success");
    backupStatus.textContent = message;
  }

  exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;

    try {
      const result = await SieveIpcClient.sendMessage(
        "core", "settings-backup-export", {
          includePasswords: exportPasswords.checked
        });

      if (!result.canceled)
        showBackupStatus(i18n.getString("settings.backup.exported"));
    } catch (ex) {
      showBackupStatus(
        `${i18n.getString("settings.backup.failed")} ${ex.message || ex}`, true);
    } finally {
      exportButton.disabled = false;
    }
  });

  importButton.addEventListener("click", async () => {
    importButton.disabled = true;

    try {
      const result = await SieveIpcClient.sendMessage(
        "core", "settings-backup-open");

      if (result.canceled)
        return;

      pendingBackup = result;
      document.querySelector("#sieve-settings-import-accounts")
        .textContent = `${result.accounts}`;
      document.querySelector("#sieve-settings-import-password-count")
        .textContent = `${result.passwords}`;
      importPasswords.checked = result.passwords > 0;
      importPasswords.disabled = result.passwords === 0;
      importDialog.show();
    } catch (ex) {
      showBackupStatus(
        `${i18n.getString("settings.backup.failed")} ${ex.message || ex}`, true);
    } finally {
      importButton.disabled = false;
    }
  });

  document.querySelector("#sieve-settings-import-dialog")
    .addEventListener("hidden.bs.modal", async () => {
      if (importInProgress)
        return;

      pendingBackup = null;
      await SieveIpcClient.sendMessage("core", "settings-backup-cancel");
    });

  importAccept.addEventListener("click", async () => {
    if (!pendingBackup)
      return;

    importAccept.disabled = true;
    importInProgress = true;
    importDialog.hide();
    pendingBackup = null;

    try {
      await SieveIpcClient.sendMessage("core", "settings-backup-import", {
        includePasswords: importPasswords.checked
      });
      showBackupStatus(i18n.getString("settings.backup.imported"));

      setTimeout(async () => {
        await SieveIpcClient.sendMessage("core", "reload-ui");
      }, SETTINGS_RELOAD_DELAY_MS);
    } catch (ex) {
      showBackupStatus(
        `${i18n.getString("settings.backup.failed")} ${ex.message || ex}`, true);
      importAccept.disabled = false;
    } finally {
      importInProgress = false;
    }
  });
}

/**
 * Shows initialization errors instead of leaving an empty settings page.
 *
 * @param {Error|string} error
 *   the settings initialization error
 */
function showInitializationError(error) {
  console.error(error);

  const alert = document.createElement("div");
  alert.className = "alert alert-danger mt-4";
  alert.setAttribute("role", "alert");
  alert.textContent = `Settings could not be loaded: ${error?.message || error}`;

  document.querySelector(".siv-settings").replaceChildren(alert);
}

if (document.readyState !== 'loading')
  main().catch(showInitializationError);
else
  document.addEventListener('DOMContentLoaded', () => {
    main().catch(showInitializationError);
  }, { once: true });
