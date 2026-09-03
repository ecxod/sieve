/*
 * The content of this file is licensed. You may obtain a copy of
 * the license at https://github.com/thsmi/sieve/ or request it via
 * email from the author.
 *
 * Do not remove or change this comment.
 */

const BYTES_PER_MEBIBYTE = 1024 * 1024;

const UPDATE_PROGRESS_TRANSLATIONS = new Map([
  ["checking", "settings.update.progress.checking"],
  ["preparing", "settings.update.progress.preparing"],
  ["downloading", "settings.update.progress.downloading"],
  ["verifying", "settings.update.progress.verifying"],
  ["starting", "settings.update.progress.starting"],
  ["started", "settings.update.progress.started"],
  ["failed", "settings.update.progress.failed"]
]);

/**
 * Renders update progress into the settings page.
 */
class SieveUpdateProgressUI {

  /**
   * @param {object} i18n
   *   translation provider.
   * @param {object} elements
   *   progress container, label, size and bar elements.
   */
  constructor(i18n, elements) {
    this.i18n = i18n;
    this.container = elements.container;
    this.label = elements.label;
    this.size = elements.size;
    this.bar = elements.bar;
  }

  /**
   * Formats a byte count in binary megabytes.
   *
   * @param {number} bytes
   *   byte count.
   * @returns {string}
   *   localized size.
   */
  formatSize(bytes) {
    const size = bytes / BYTES_PER_MEBIBYTE;

    return `${size.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    })} MiB`;
  }

  /**
   * Hides and resets the progress display.
   */
  hide() {
    this.container.classList.add("d-none");
    this.label.textContent = "";
    this.size.textContent = "";
    this.bar.style.width = "0%";
    this.bar.removeAttribute("aria-valuenow");
    this.bar.removeAttribute("aria-valuetext");
  }

  /**
   * Renders one normalized update progress message.
   *
   * @param {object} progress
   *   normalized progress data.
   */
  show(progress) {
    const translation = UPDATE_PROGRESS_TRANSLATIONS.get(progress?.phase);

    if (!translation)
      return;

    const hasByteCounts = Number.isInteger(progress.received)
      && Number.isInteger(progress.total)
      && Number.isInteger(progress.percent);
    const isFinished = progress.phase === "started";
    const isFailed = progress.phase === "failed";

    this.container.classList.remove("d-none");
    this.label.textContent = this.i18n.getString(translation);
    this.bar.classList.toggle(
      "progress-bar-animated", !isFinished && !isFailed);
    this.bar.classList.toggle("bg-success", isFinished);
    this.bar.classList.toggle("bg-danger", isFailed);

    if (!hasByteCounts) {
      this.size.textContent = "";
      this.bar.style.width = "100%";
      this.bar.removeAttribute("aria-valuenow");
      this.bar.removeAttribute("aria-valuetext");
      return;
    }

    const size = `${this.formatSize(progress.received)} / `
      + `${this.formatSize(progress.total)} (${progress.percent} %)`;

    this.size.textContent = size;
    this.bar.style.width = `${progress.percent}%`;
    this.bar.setAttribute("aria-valuenow", `${progress.percent}`);
    this.bar.setAttribute("aria-valuetext", size);
  }
}

export { SieveUpdateProgressUI };
