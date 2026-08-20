# ecxod/sieve fork

This fork exists to provide a Sieve build with CRAM-MD5 authentication for
Thunderbird and Windows distribution from `ecxod/sieve`.

## Differences from upstream

- CRAM-MD5 is part of automatic SASL mechanism selection and the manual
  authentication mechanism list. The implementation includes the HMAC-MD5
  calculation required by RFC 2195 and tests against the RFC 2195 reference
  exchange.
- Starting with `0.6.1.2`, the editor no longer checks syntax automatically
  after every change. The server validates a script when it is saved, and a
  dedicated **Syntax check** button allows an explicit check without saving.
  This is the fork's first deliberate editor-behaviour difference from the
  upstream project and prevents multiple open editor tabs from continuously
  starting server-side syntax checks while typing or pasting.
- Version `0.6.1.3` keeps the syntax error panel hidden when an editor opens.
  It becomes visible only when the manual syntax check reports an actual
  error.
- Version `0.6.1.4` identifies the Windows application as the `ecxod/sieve`
  CRAM-MD5 fork in a small persistent footer. It also removes the donation
  buttons and the project's donation links and metadata.
- The Windows application now offers **System**, **Light**, and **Dark** under
  **Settings → Appearance**. The selected theme is persisted and is applied to
  the application, all open tabs, and CodeMirror syntax highlighting.
- Server cards on **Home** can be reduced to their server name with the arrow
  button. This state is stored per server; a collapsed server does not load its
  script list until it is expanded.
- Version `0.6.1.5` keeps the server name visible when a server card is
  collapsed and moves the global appearance setting to a fixed **Settings**
  tab on the right side of the main tab bar. Server capabilities can now also
  be opened while disconnected: the app connects temporarily, reads the
  capabilities, and disconnects again. SASL mechanisms learned during the
  connection handshake remain visible if a later capability response omits
  them, and `i-default` is identified as the server's default response
  language. A connected server offers only **Disconnect**, while a disconnected
  server offers only **Connect**; duplicate connection attempts are blocked.
  The delete button is disabled for the active script, and its delete handler
  and backend refuse the operation as an additional safeguard. Textual account
  settings and script names are trimmed before use and persistence; passwords
  and script contents remain unchanged.
- No Sentry project is built into the fork. The global **Settings** tab accepts
  an optional user-owned Sentry DSN for error reporting. An empty DSN keeps
  tracking disabled, which is the default, and the SDK is configured not to
  send default personally identifiable information or performance traces.
- Version `0.6.1.6` makes a collapsed server's name an additional expand
  control and explicitly handles the fixed global **Settings** tab so its
  appearance and Sentry options reliably open when clicked.

These differences are maintained alongside the fork packaging and distribution
metadata, updater links, and the Thunderbird settings display fix.

## Repository scope

Unused upstream infrastructure has been removed from the fork: Azure pipelines,
the development-only `tools` collection, obsolete editor and service
configuration, and stale upstream planning and governance documents. The
`gulp` directory remains because it contains the active build, packaging, and
test tasks for the Windows application, Thunderbird extension, and shared code.
The obsolete `src/TODO.md` file has also been removed.

## Thunderbird package

The installable package is
[`releases/sieve-0.6.1.6-cram-md5.xpi`](releases/sieve-0.6.1.6-cram-md5.xpi).

SHA-256: `d2ad30c0813bd193e2d9f57527beb53bd6e9ef7b2bea8070b6df5ceb8560f350`

## Windows installer

The installable Windows package is
[`releases/install_sieve_0.6.1.6.exe`](releases/install_sieve_0.6.1.6.exe).

SHA-256: `1a07ab167048797d50b6f202b12782cb7385f59e0639aa635840e044779d3ae5`
