/*
 * Optional, user-configured Sentry error tracking for the Windows app.
 * No DSN is built into this fork; an empty setting disables all reporting.
 */

const path = require('path');
const {
  mkdirSync,
  readFileSync,
  writeFileSync
} = require('fs');

const { app } = require('electron');
const Sentry = require('@sentry/electron/main');

const SENTRY_CONFIG_FILENAME = "sentry.json";
const JSON_INDENTATION = 2;
const CONFIG_FILE_PERMISSIONS = 0o600;

/**
 * Validates and normalizes an optional Sentry DSN.
 *
 * @param {string} dsn
 *   the configured Sentry DSN
 * @returns {string}
 *   the trimmed DSN or an empty string
 */
function normalizeDsn(dsn) {
  dsn = `${dsn || ""}`.trim();

  if (!dsn)
    return "";

  const parsed = new URL(dsn);
  if (!["http:", "https:"].includes(parsed.protocol)
    || !parsed.hostname || !parsed.username
    || parsed.pathname.split("/").filter(Boolean).length === 0)
    throw new Error("Invalid Sentry DSN");

  return dsn;
}

/**
 * Gets the path used for the optional Sentry configuration.
 *
 * @returns {string}
 *   the absolute configuration file path
 */
function getConfigPath() {
  return path.join(app.getPath("userData"), SENTRY_CONFIG_FILENAME);
}

/**
 * Reads the user-provided Sentry DSN. Invalid or missing settings disable
 * tracking rather than falling back to a built-in tracker.
 *
 * @returns {string}
 *   the configured DSN or an empty string
 */
function loadDsn() {
  try {
    const config = JSON.parse(readFileSync(getConfigPath(), "utf8"));
    return normalizeDsn(config.dsn);
  } catch {
    return "";
  }
}

let sentryDsn = loadDsn();

/**
 * Initializes Sentry before Electron emits its ready event.
 */
function init() {
  Sentry.init({
    dsn: sentryDsn || undefined,
    enabled: sentryDsn !== "",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    release: `sieve@${app.getVersion()}`
  });
}

/**
 * Gets the currently persisted DSN.
 *
 * @returns {string}
 *   the configured DSN or an empty string
 */
function getDsn() {
  return sentryDsn;
}

/**
 * Persists the optional Sentry DSN.
 *
 * @param {string} dsn
 *   the DSN to persist; an empty value disables tracking after restart
 * @returns {string}
 *   the normalized DSN
 */
function setDsn(dsn) {
  sentryDsn = normalizeDsn(dsn);

  const filename = getConfigPath();
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, JSON.stringify({ dsn: sentryDsn }, null, JSON_INDENTATION), {
    encoding: "utf8",
    mode: CONFIG_FILE_PERMISSIONS
  });

  return sentryDsn;
}

module.exports = {
  getDsn,
  init,
  setDsn
};
