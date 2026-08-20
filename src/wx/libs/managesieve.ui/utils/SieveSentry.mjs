/*
 * Minimal Sentry transport for the Thunderbird WebExtension.
 *
 * Thunderbird does not bundle the Electron Sentry SDK used by the desktop
 * application. Keeping this transport local also avoids loading executable
 * code from a third-party CDN, which is not permitted for extensions.
 */

/* global browser */

const SENTRY_DSN = "https://31d5a82de6c54ff7a8365bd179f394b3@sentry.zp1.net/43";
const SENTRY_PROTOCOL_VERSION = "7";
const MAX_EXTRA_LENGTH = 2000;
const EVENT_ID_BYTES = 16;
const HEX_RADIX = 16;
const HEX_WIDTH = 2;
const MAX_ARRAY_ITEMS = 20;
const MILLISECONDS_PER_SECOND = 1000;

let initialized = false;
let component = "thunderbird-xpi";

/**
 * Creates a Sentry-compatible event id.
 *
 * @returns {string}
 *   a 32-character hexadecimal event id.
 */
function createEventId() {
  const bytes = new Uint8Array(EVENT_ID_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => {
    return value.toString(HEX_RADIX).padStart(HEX_WIDTH, "0");
  }).join("");
}

/**
 * Converts thrown strings and other values into an Error.
 *
 * @param {*} value
 *   the thrown value.
 * @returns {Error}
 *   a normalized error.
 */
function normalizeError(value) {
  if (value instanceof Error)
    return value;

  if (value && typeof value.message === "string") {
    const error = new Error(value.message);
    error.name = value.name || "Error";
    error.stack = value.stack || error.stack;
    return error;
  }

  return new Error(String(value));
}

/**
 * Removes data which should not be sent with an error report.
 *
 * @param {*} value
 *   the value to sanitize.
 * @returns {*}
 *   the sanitized value.
 */
function sanitize(value) {
  if (value === undefined)
    return undefined;

  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;

  if (typeof value === "string") {
    return value
      .replace(SENTRY_DSN, "[sentry-dsn]")
      .replace(/(password|passwd|pwd)=([^&\s]+)/gi, "$1=[redacted]")
      .slice(0, MAX_EXTRA_LENGTH);
  }

  if (Array.isArray(value))
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => {
      return sanitize(item);
    });

  if (typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (/password|passwd|credential|authorization/i.test(key)) {
        result[key] = "[redacted]";
        continue;
      }

      result[key] = sanitize(item);
    }
    return result;
  }

  return String(value).slice(0, MAX_EXTRA_LENGTH);
}

/**
 * Parses the most common Firefox and Chromium stack-frame formats.
 *
 * @param {string} stack
 *   an Error stack.
 * @returns {object[]}
 *   Sentry stack frames ordered from oldest to newest.
 */
function parseStack(stack) {
  if (!stack)
    return [];

  const frames = [];
  // Stack matches have fixed positions for function, file, line and column.
  /* eslint-disable no-magic-numbers */
  for (const line of stack.split("\n").slice(1)) {
    let match = line.match(/^\s*([^@]*)@(.+):(\d+):(\d+)\s*$/);
    if (!match)
      match = line.match(/^\s*at\s+(?:(.*?)\s+\()?(.+):(\d+):(\d+)\)?\s*$/);

    if (!match)
      continue;

    frames.push({
      function: match[1] || "<anonymous>",
      filename: match[2],
      lineno: Number.parseInt(match[3], 10),
      colno: Number.parseInt(match[4], 10)
    });
  }
  /* eslint-enable no-magic-numbers */

  return frames.reverse();
}

/**
 * Gets the extension version without depending on it during unit tests.
 *
 * @returns {string}
 *   the packaged extension version.
 */
function getVersion() {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return "unknown";
  }
}

/**
 * Sends an exception to the Sentry project configured for this fork.
 * Reporting failures are deliberately ignored so they cannot break Sieve.
 *
 * @param {*} value
 *   the exception or rejected value.
 * @param {object} [context]
 *   non-sensitive diagnostic context.
 * @returns {Promise<string|null>}
 *   the Sentry event id, or null when delivery failed.
 */
async function captureException(value, context = {}) {
  const error = normalizeError(value);
  const eventId = createEventId();
  const dsn = new URL(SENTRY_DSN);
  const projectId = dsn.pathname.replace(/^\/+|\/+$/g, "");
  const endpoint = `${dsn.protocol}//${dsn.host}/api/${projectId}/store/`
    + `?sentry_version=${SENTRY_PROTOCOL_VERSION}&sentry_key=${encodeURIComponent(dsn.username)}`;
  const version = getVersion();
  const frames = parseStack(error.stack);

  const operation = context.action || context.source || context.stage || "unknown";
  const exception = {
    type: error.name || "Error",
    value: sanitize(`[${component}:${operation}] ${error.message || String(error)}`)
  };

  if (frames.length)
    exception.stacktrace = { frames: frames };

  const event = {
    // Sentry's ingestion schema requires snake-case wire field names.
    /* eslint-disable camelcase */
    event_id: eventId,
    timestamp: Date.now() / MILLISECONDS_PER_SECOND,
    platform: "javascript",
    level: "error",
    logger: "sieve-cram-md5",
    release: `sieve-cram-md5@${version}`,
    environment: "production",
    tags: {
      application: "thunderbird-extension",
      component: component,
      operation: sanitize(operation)
    },
    contexts: {
      app: {
        app_name: "Sieve CRAM-MD5",
        app_version: version
      }
    },
    exception: { values: [exception] },
    extra: sanitize(context)
    /* eslint-enable camelcase */
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event)
    });

    if (!response.ok)
      throw new Error(`Sentry returned HTTP ${response.status}`);
  } catch (reportingError) {
    console.error("Could not send error report to Sentry", reportingError);
    return null;
  }

  return eventId;
}

/**
 * Installs global exception and rejected-promise handlers once per page.
 *
 * @param {string} source
 *   the extension component owning the current page.
 */
function initSentry(source) {
  component = source || component;

  globalThis.SieveErrorReporter = { captureException: captureException };

  if (initialized || typeof globalThis.addEventListener !== "function")
    return;

  initialized = true;

  globalThis.addEventListener("error", (event) => {
    captureException(event.error || new Error(event.message), {
      source: "window.error",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });

  globalThis.addEventListener("unhandledrejection", (event) => {
    captureException(event.reason, { source: "unhandledrejection" });
  });
}

export { captureException, initSentry };
