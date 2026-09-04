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
const THEME_DARK_LIGHT = "dark-light";
const THEME_AMOLED = "amoled";
const THEME_STYLE_ID = "sieve-theme-style";

const THEME_STYLE = `
html[data-sieve-theme="dark"] {
  --bs-border-color: #626a73;
  --bs-border-color-translucent: rgba(255, 255, 255, 0.24);
  --sieve-control-edge: rgba(255, 255, 255, 0.16);
  --sieve-outline-secondary: #aeb6bf;
}

html[data-sieve-theme="dark-light"] {
  color-scheme: dark;
  --bs-body-bg: #252a2f;
  --bs-body-bg-rgb: 37, 42, 47;
  --bs-secondary-bg: #343a40;
  --bs-secondary-bg-rgb: 52, 58, 64;
  --bs-tertiary-bg: #30363c;
  --bs-tertiary-bg-rgb: 48, 54, 60;
  --bs-border-color: #7c858f;
  --bs-border-color-translucent: rgba(255, 255, 255, 0.32);
  --sieve-control-edge: rgba(255, 255, 255, 0.22);
  --sieve-outline-secondary: #c3c9d0;
}

html[data-sieve-theme="amoled"] {
  color-scheme: dark;
  --bs-body-bg: #000;
  --bs-body-bg-rgb: 0, 0, 0;
  --bs-secondary-bg: #0b0b0c;
  --bs-secondary-bg-rgb: 11, 11, 12;
  --bs-tertiary-bg: #111214;
  --bs-tertiary-bg-rgb: 17, 18, 20;
  --bs-border-color: #59616a;
  --bs-border-color-translucent: rgba(255, 255, 255, 0.26);
  --sieve-control-edge: rgba(255, 255, 255, 0.19);
  --sieve-outline-secondary: #b8c0c8;
}

html[data-sieve-theme="dark"] .btn,
html[data-sieve-theme="dark-light"] .btn,
html[data-sieve-theme="amoled"] .btn {
  box-shadow: inset 0 0 0 1px var(--sieve-control-edge);
}

html[data-sieve-theme="dark"] .btn-outline-secondary,
html[data-sieve-theme="dark-light"] .btn-outline-secondary,
html[data-sieve-theme="amoled"] .btn-outline-secondary {
  --bs-btn-color: var(--sieve-outline-secondary);
  --bs-btn-border-color: var(--sieve-outline-secondary);
  --bs-btn-hover-bg: var(--sieve-outline-secondary);
  --bs-btn-hover-border-color: var(--sieve-outline-secondary);
  --bs-btn-disabled-color: var(--sieve-outline-secondary);
  --bs-btn-disabled-border-color: var(--sieve-outline-secondary);
}

html[data-sieve-theme="amoled"] .card,
html[data-sieve-theme="amoled"] .modal-content,
html[data-sieve-theme="amoled"] .dropdown-menu {
  --bs-card-bg: #050506;
  --bs-modal-bg: #050506;
  --bs-dropdown-bg: #09090a;
}

.sieve-check-success {
  color: #fff !important;
  background-color: #198754 !important;
  border-color: #36b37e !important;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2) !important;
  transition: none !important;
}

.sieve-check-success.sieve-check-success-fade {
  color: var(--bs-btn-color) !important;
  background-color: var(--bs-btn-bg) !important;
  border-color: var(--bs-btn-border-color) !important;
  box-shadow: inset 0 0 0 1px var(--sieve-control-edge, transparent) !important;
  transition: color 1.6s ease, background-color 1.6s ease,
    border-color 1.6s ease, box-shadow 1.6s ease !important;
}

@media (prefers-reduced-motion: reduce) {
  .sieve-check-success.sieve-check-success-fade {
    transition-duration: 0.01ms !important;
  }
}`;

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
    if ([THEME_SYSTEM, THEME_LIGHT, THEME_DARK,
      THEME_DARK_LIGHT, THEME_AMOLED].includes(theme))
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

    if (theme === THEME_LIGHT || theme === THEME_DARK)
      return theme;

    if (theme === THEME_DARK_LIGHT || theme === THEME_AMOLED)
      return THEME_DARK;

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
    this.preset = this.preference === THEME_SYSTEM
      ? this.effective
      : this.preference;

    if (!document.querySelector(`#${THEME_STYLE_ID}`)) {
      const style = document.createElement("style");
      style.id = THEME_STYLE_ID;
      style.textContent = THEME_STYLE;
      document.head.append(style);
    }

    document.documentElement.setAttribute('data-bs-theme', this.effective);
    document.documentElement.setAttribute('data-sieve-theme', this.preset);
    window.dispatchEvent(new CustomEvent("sieve-theme-changed", {
      detail: {
        preference: this.preference,
        effective: this.effective,
        preset: this.preset
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
SieveTheme.preset = THEME_LIGHT;
SieveTheme.initialized = false;

export { SieveTheme };
