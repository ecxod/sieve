/* global browser */

const CONFIG_KEY_DEVELOPER = "global.developer";

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
  const status = document.querySelector("#options-status");

  document.querySelector("#options-title").textContent = getMessage(
    "optionsTitle", "Sieve CRAM-MD5 – Options");
  document.querySelector("#options-developer-label").textContent = getMessage(
    "optionsDeveloperLabel", "I am a developer");
  document.querySelector("#options-developer-description").textContent = getMessage(
    "optionsDeveloperDescription",
    "Show the Debugging button in a Sieve server's settings.");

  const values = await browser.storage.local.get(CONFIG_KEY_DEVELOPER);
  developer.checked = values[CONFIG_KEY_DEVELOPER] === true;

  developer.addEventListener("change", async () => {
    await browser.storage.local.set({
      [CONFIG_KEY_DEVELOPER]: developer.checked
    });
    status.textContent = getMessage("optionsSaved", "Saved");
  });
}

if (document.readyState !== "loading")
  main();
else
  document.addEventListener("DOMContentLoaded", () => { main(); }, { once: true });
