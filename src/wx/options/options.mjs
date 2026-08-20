/* global browser */

import { normalizeSentryDsn } from
  "../libs/managesieve.ui/utils/SieveSentry.mjs";

const CONFIG_KEY_DEVELOPER = "global.developer";
const CONFIG_KEY_SENTRY_DSN = "global.sentryDsn";

/**
 * Gets a localized WebExtension message or a bundled fallback.
 *
 * @param {string} key
 *   the locale message key.
 * @param {string} fallback
 *   the fallback shown when the locale has no translation.
 * @returns {string}
 *   the translated or fallback string.
 */
function getMessage(key, fallback) {
  return browser.i18n.getMessage(key) || fallback;
}

/**
 * Initializes the extension options page.
 */
async function main() {
  const developer = document.querySelector("#sieve-option-developer");
  const sentryDsn = document.querySelector("#sieve-option-sentry-dsn");
  const status = document.querySelector("#options-status");

  document.querySelector("#options-title").textContent = getMessage(
    "optionsTitle", "Sieve CRAM-MD5 – Options");
  document.querySelector("#options-developer-label").textContent = getMessage(
    "optionsDeveloperLabel", "I am a developer");
  document.querySelector("#options-developer-description").textContent = getMessage(
    "optionsDeveloperDescription",
    "Show the Debugging button in a Sieve server's settings.");
  document.querySelector("#options-sentry-title").textContent = getMessage(
    "optionsSentryTitle", "Error reports (Sentry)");
  document.querySelector("#options-sentry-description").textContent = getMessage(
    "optionsSentryDescription",
    "Optional. No error reports are sent without a DSN.");
  document.querySelector("#options-sentry-label").textContent = getMessage(
    "optionsSentryLabel", "Sentry DSN");
  document.querySelector("#sieve-option-sentry-save").textContent = getMessage(
    "optionsSentrySave", "Save Sentry setting");

  const values = await browser.storage.local.get([
    CONFIG_KEY_DEVELOPER,
    CONFIG_KEY_SENTRY_DSN
  ]);
  developer.checked = values[CONFIG_KEY_DEVELOPER] === true;
  sentryDsn.value = values[CONFIG_KEY_SENTRY_DSN] || "";

  developer.addEventListener("change", async () => {
    await browser.storage.local.set({
      [CONFIG_KEY_DEVELOPER]: developer.checked
    });
    status.textContent = getMessage("optionsSaved", "Saved");
  });

  document.querySelector("#sieve-option-sentry-save")
    .addEventListener("click", async () => {
      sentryDsn.setCustomValidity("");

      let value;
      try {
        value = normalizeSentryDsn(sentryDsn.value);
      } catch {
        const message = getMessage(
          "optionsSentryInvalid",
          "Enter a valid HTTPS DSN for sentry.zp1.net.");
        sentryDsn.setCustomValidity(message);
        sentryDsn.reportValidity();
        status.textContent = message;
        return;
      }

      sentryDsn.value = value;
      if (value) {
        await browser.storage.local.set({ [CONFIG_KEY_SENTRY_DSN]: value });
        status.textContent = getMessage(
          "optionsSentryEnabled", "Sentry error reports enabled");
        return;
      }

      await browser.storage.local.remove(CONFIG_KEY_SENTRY_DSN);
      status.textContent = getMessage(
        "optionsSentryDisabled", "Sentry error reports disabled");
    });
}

if (document.readyState !== "loading")
  main();
else
  document.addEventListener("DOMContentLoaded", () => { main(); }, { once: true });
