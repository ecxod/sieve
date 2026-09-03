/*
 * The content of this file is licensed. You may obtain a copy of
 * the license at https://github.com/thsmi/sieve/ or request it via
 * email from the author.
 *
 * Do not remove or change this comment.
 */

const UPDATE_PROGRESS_PHASES = new Set([
  "checking",
  "preparing",
  "downloading",
  "verifying",
  "starting",
  "started",
  "canceled",
  "failed"
]);

/**
 * Normalizes an update progress message before it crosses UI boundaries.
 *
 * @param {object} progress
 *   update progress message.
 * @returns {object|null}
 *   normalized progress or null when the message is invalid.
 */
function normalizeUpdateProgress(progress) {
  if (!progress || typeof progress !== "object"
    || !UPDATE_PROGRESS_PHASES.has(progress.phase))
    return null;

  const normalized = { phase: progress.phase };
  const hasReceived = progress.received !== undefined;
  const hasTotal = progress.total !== undefined;

  if (!hasReceived && !hasTotal)
    return normalized;

  if (!hasReceived || !hasTotal
    || !Number.isInteger(progress.received)
    || !Number.isInteger(progress.total)
    || progress.received < 0
    || progress.total < 1
    || progress.received > progress.total)
    return null;

  normalized.received = progress.received;
  normalized.total = progress.total;
  normalized.percent = Math.floor(
    (progress.received * 100) / progress.total);

  return normalized;
}

/**
 * Tracks verified installer bytes and emits throttled progress messages.
 */
class SieveUpdateProgress {

  /**
   * @param {number} total
   *   expected installer size.
   * @param {Function} listener
   *   receiver for normalized progress messages.
   */
  constructor(total, listener) {
    if (!Number.isInteger(total) || total < 1)
      throw new Error("Invalid update installer size");
    if (typeof listener !== "function")
      throw new Error("Invalid update progress listener");

    this.total = total;
    this.received = 0;
    this.listener = listener;
    this.lastPercent = null;
  }

  /**
   * Emits a phase together with the current byte counts.
   *
   * @param {string} phase
   *   update phase.
   */
  setPhase(phase) {
    const progress = normalizeUpdateProgress({
      phase,
      received: this.received,
      total: this.total
    });

    if (progress === null)
      throw new Error("Invalid update progress phase");

    this.lastPercent = progress.percent;
    this.listener(progress);
  }

  /**
   * Adds a downloaded chunk and emits at most one event per percentage point.
   *
   * @param {number} size
   *   chunk size in bytes.
   * @returns {number}
   *   total number of received bytes.
   */
  addChunk(size) {
    if (!Number.isInteger(size) || size < 0)
      throw new Error("Invalid update download chunk size");

    const received = this.received + size;

    if (received > this.total)
      throw new Error("The update download is larger than expected");

    this.received = received;
    const percent = Math.floor((this.received * 100) / this.total);

    if (percent !== this.lastPercent)
      this.setPhase("downloading");

    return this.received;
  }

  /**
   * Ensures that the complete installer has arrived before verification.
   */
  beginVerification() {
    if (this.received !== this.total)
      throw new Error("The update download is incomplete");

    this.setPhase("verifying");
  }
}

export { normalizeUpdateProgress, SieveUpdateProgress };
