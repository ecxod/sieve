/*
 * The content of this file is licensed. You may obtain a copy of
 * the license at https://github.com/thsmi/sieve/ or request it via
 * email from the author.
 *
 * Do not remove or change this comment.
 */

const SUCCESS_HOLD_MS = 700;
const SUCCESS_FADE_MS = 1600;
const successTimers = new WeakMap();

/**
 * Briefly marks a successful check and then fades back to the button style.
 *
 * @param {HTMLElement} button
 *   the check button which completed successfully.
 */
function showCheckSuccess(button) {
  const previous = successTimers.get(button) || [];
  for (const timer of previous)
    window.clearTimeout(timer);

  button.classList.remove("sieve-check-success", "sieve-check-success-fade");
  // Restart the effect when a check is repeated during the previous fade.
  button.getBoundingClientRect();
  button.classList.add("sieve-check-success");

  const fade = window.setTimeout(() => {
    button.classList.add("sieve-check-success-fade");
  }, SUCCESS_HOLD_MS);
  const reset = window.setTimeout(() => {
    button.classList.remove("sieve-check-success", "sieve-check-success-fade");
    successTimers.delete(button);
  }, SUCCESS_HOLD_MS + SUCCESS_FADE_MS);

  successTimers.set(button, [fade, reset]);
}

export { showCheckSuccess };
