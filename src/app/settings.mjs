/*
 * The content of this file is licensed. You may obtain a copy of
 * the license at https://github.com/thsmi/sieve/ or request it via
 * email from the author.
 *
 * Do not remove or change this comment.
 */

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
