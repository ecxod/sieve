/*
 * The content of this file is licensed. You may obtain a copy of
 * the license at https://github.com/thsmi/sieve/ or request it via
 * email from the author.
 *
 * Do not remove or change this comment.
 */

const THEME_SYSTEM = "system";
const THEME_LIGHT = "light";
const THEME_DARK = "dark";

/**
 * Applies and synchronizes the application's color theme.
 */
class SieveTheme {

  /**
   * Checks and normalizes a theme preference.
   *
   * @param {string} theme
   *   the configured theme
   * @returns {string}
   *   a supported theme
   */
  static normalize(theme) {
    if ([THEME_SYSTEM, THEME_LIGHT, THEME_DARK].includes(theme))
      return theme;

    return THEME_SYSTEM;
  }

  /**
   * Resolves the configured preference to a Bootstrap theme.
   *
   * @param {string} theme
   *   the configured theme
   * @returns {string}
   *   either light or dark
   */
  static resolve(theme) {
    theme = this.normalize(theme);

    if (theme !== THEME_SYSTEM)
      return theme;

    if (window.matchMedia('(prefers-color-scheme: dark)').matches)
      return THEME_DARK;

    return THEME_LIGHT;
  }

  /**
   * Applies a theme to the current document.
   *
   * @param {string} theme
   *   the configured theme
   * @returns {string}
   *   the effective theme
   */
  static apply(theme) {
    this.preference = this.normalize(theme);
    this.effective = this.resolve(this.preference);

    document.documentElement.setAttribute('data-bs-theme', this.effective);
    window.dispatchEvent(new CustomEvent("sieve-theme-changed", {
      detail: {
        preference: this.preference,
        effective: this.effective
      }
    }));

    return this.effective;
  }

  /**
   * Initializes theme handling in a window.
   *
   * @param {string} theme
   *   the configured theme
   */
  static init(theme) {
    this.apply(theme);

    if (this.initialized)
      return;

    this.initialized = true;

    window.addEventListener("message", (event) => {
      if (event.data?.type !== "sieve-theme")
        return;

      this.apply(event.data.theme);
    });

    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener("change", () => {
        if (this.preference === THEME_SYSTEM)
          this.apply(THEME_SYSTEM);
      });
  }

  /**
   * Sends a theme change to all application frames.
   *
   * @param {Window} target
   *   the top-level window
   * @param {string} theme
   *   the configured theme
   */
  static broadcast(target, theme) {
    const message = {
      type: "sieve-theme",
      theme: this.normalize(theme)
    };

    target.postMessage(message, "*");

    for (let idx = 0; idx < target.frames.length; idx++)
      target.frames[idx].postMessage(message, "*");
  }

  /**
   * Gets the CodeMirror theme matching the current Bootstrap theme.
   *
   * @returns {string}
   *   the CodeMirror theme name
   */
  static getCodeMirrorTheme() {
    if (this.effective === THEME_DARK)
      return "material-darker";

    return "eclipse";
  }
}

SieveTheme.preference = THEME_SYSTEM;
SieveTheme.effective = THEME_LIGHT;
SieveTheme.initialized = false;

export { SieveTheme };
