# ecxod/sieve fork

This fork exists to provide a Sieve build with CRAM-MD5 authentication for
Thunderbird and Windows distribution from `ecxod/sieve`.

## Current stable release

**Version 0.8.8 is the latest stable release for both distributed packages:**

- Windows: `install_sieve_0.8.8.exe`
- Thunderbird: `sieve-0.8.8-cram-md5.xpi`

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
- Server cards on **Home** can be reduced to their server name by clicking the
  server-name tab. This state is stored per server; a collapsed server does not
  load its script list until it is expanded.
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
- The Windows application has no built-in Sentry project. Its global
  **Settings** tab accepts an optional user-owned Sentry DSN for error
  reporting. An empty DSN keeps tracking disabled, which is the default, and
  the SDK is configured not to send default personally identifiable
  information or performance traces.
- Version `0.6.1.6` makes a collapsed server's name an additional expand
  control and explicitly handles the fixed global **Settings** tab so its
  appearance and Sentry options reliably open when clicked.
- Version `0.6.1.7` removes the separate account-collapse button: the server-name
  tab now expands and collapses the card. Connecting or disconnecting selects
  the server's script tab, and **New script** is visible only while connected.
- Version `0.6.1.8` fixes the global **Settings** tab so its appearance and
  Sentry controls are rendered instead of an empty page. Initialization errors
  are shown visibly instead of leaving the settings view blank.
- Version `0.6.1.9` gives the Thunderbird fork its own extension ID,
  `sieve-cram-md5@ecxod.github.io`, and identifies the extension as **Sieve
  CRAM-MD5** by `ecxod`. Its homepage, update source, and issue tracker all
  point to `ecxod/sieve`; Thunderbird can therefore no longer merge upstream
  catalogue metadata or upstream releases into this fork.
- Version `0.6.1.10` enables error reporting for the Thunderbird extension with
  the fork's `sentry.zp1.net` project, because the Windows-only settings band is
  not part of the XPI. Background connection errors, UI initialization errors,
  and unhandled exceptions are reported without deliberately attaching account
  IDs; common password and credential fields are redacted. A failed UI/IPC
  connection attempt now always renders the final connection state instead of
  leaving the server card on **Connecting**.
- Version `0.6.1.11` exposes privileged Thunderbird Experiment errors instead
  of replacing them with **An unexpected error occurred**. It also reports
  asynchronous socket-transport setup failures, includes the attempted host and
  port in connection diagnostics, ignores the expected missing-receiver race
  when an accounts tab closes, and emits one XPI-originated Sentry startup
  verification event per version.
- Version `0.6.1.12` awaits Thunderbird's asynchronous menu APIs and skips menu
  locations which do not exist in the installed Thunderbird version. This
  prevents several generic startup errors caused by rejected Experiment API
  promises. Expected request cancellation while closing the last Sieve tab is
  no longer reported as an error, and Sentry titles now identify the component
  and operation which failed.
- Version `0.6.1.13` keeps socket setup and socket writes in the connection
  promise chain. Privileged API failures can therefore no longer escape as an
  unhandled rejection while the UI waits forever for a server greeting. It
  also loads the modern `Services.sys.mjs` module on current Thunderbird and
  retains the legacy module fallback for older supported versions.
- Version `0.6.1.14` adds the individual socket setup stage to errors before
  they reach the UI and Sentry. Its attempted port-schema correction was
  incomplete and is superseded by `0.6.1.15`.
- Version `0.6.1.15` corrects the socket schema to match `SieveUrl`, which
  supplies the port as a string, and explicitly normalizes socket creation to
  `string`, `string`, `integer` for host, port, and log level.
- Version `0.6.1.16` removes the optional diagnostic log level from the
  privileged socket creation boundary. Socket creation now validates only the
  required host and port strings and uses level zero internally.
- Version `0.6.1.17` returns socket-construction failures as structured data
  instead of throwing them across Thunderbird's Experiment boundary, which
  preserves the original privileged Gecko/XPCOM error for the UI and Sentry.
  It also delays event-target lookup until the network transport is created.
- Version `0.6.1.18` registers the socket transport as a new, versioned
  Thunderbird Experiment API with new schema and implementation filenames.
  This prevents a cached pre-0.6.1.17 API definition from handling the call.
  A generation probe before socket creation makes any remaining API loading
  failure distinguishable from a network-transport failure.
- Version `0.6.1.19` removes all Gecko module imports from top-level socket
  Experiment initialization. `Services` is loaded lazily only after the v3
  generation probe succeeds, and socket errors use the built-in `Error` class
  instead of importing `ExtensionError`. This prevents a version-specific
  module import from disabling every method in the Experiment API.
- Version `0.6.1.20` upgrades STARTTLS through Gecko's current
  `nsITLSSocketControl.asyncStartTLS()` API while retaining the legacy
  `nsISSLSocketControl.StartTLS()` fallback. TLS upgrade failures are returned
  as structured diagnostics instead of being hidden by the Experiment bridge.
  The TLS fix ships as socket Experiment generation v4 so Thunderbird cannot
  reuse the pre-fix v3 implementation from its startup cache.
- Version `0.6.1.21` restores server management inside the Thunderbird XPI
  without reintroducing the desktop application's top tab bar. The accounts
  page has a persistent **Add Server** action for independent ManageSieve
  connections, and each server's **Settings** pane contains **Delete Server**.
  Deleting removes only the extension configuration (or hides a server derived
  from Thunderbird); it never deletes the Thunderbird mail account or any
  server-side Sieve scripts. Passwords for independently added servers are
  requested when connecting and are not persisted by the extension.
- Version `0.6.1.22` wires the Thunderbird accounts page to its concrete
  account-list controller. This activates both the **Add Server** handler and
  the confirmed **Delete Server** action; `0.6.1.21` rendered the controls but
  still instantiated the abstract controller, so deletion failed at runtime.
- Version `0.6.1.23` makes Thunderbird's IMAP and POP accounts authoritative:
  they are discovered automatically whenever the server list is rendered and
  can no longer be hidden or deleted independently inside Sieve. Any
  suppression saved by `0.6.1.21` or `0.6.1.22` is removed during migration.
  The delete section is shown only for manually created standalone ManageSieve
  servers. The manual fallback is now a large, explicitly translated **Create
  Server** button instead of an unlabelled compact control.
- Version `0.7.0` enables Thunderbird's standard **Options** button and adds an
  inline extension options page with **I am a developer**. Developer mode is
  disabled by default; the per-server **Debugging** button is rendered only
  while the checkbox is enabled. The preference is stored locally and does
  not alter server configuration.
- Version `0.7.1` removes the hard-coded Thunderbird Sentry project DSN and
  adds an optional DSN field to the standard **Options** page. The field is
  empty by default, so no error report is transmitted until the user enters
  and saves a valid HTTPS DSN on `sentry.zp1.net`. Clearing and saving the
  field disables reporting again. The synthetic per-version startup report is
  removed; only actual errors are reported after explicit configuration.
- Version `0.7.2` is the first stable release using the same version number for
  the Windows installer and Thunderbird XPI. The extension adds one
  **Thunderbird → Sieve** tab per discovered mail account. It reads that
  account's Thunderbird message filters and displays each source rule beside a
  conservative Sieve translation. Unsupported, disabled, or semantically
  different rules are guarded with `false` and carry review warnings. Existing
  server scripts are compared by generated import ID and matching rules are
  highlighted in yellow. A generated block can be copied, or inserted directly
  into a selected existing Sieve script. Direct saving adds missing `require`
  capabilities, checks the complete script on the server, refuses stale
  overwrites, and leaves script activation unchanged. Managed boundary markers
  allow an unchanged imported rule to be updated safely. The source rule can
  be opened in Thunderbird's native filter editor; deletion is offered only
  after its imported block is found and requires a second confirmation click.
  The accounts page also shows the add-on name beside **Create Server** and the
  same fork/version footer as the Windows application.
- Version `0.7.3` adds a **Make pretty** action to the source-code editor. It
  formats Sieve blocks with tabs and line breaks, preserves strings, comments,
  and multiline text, and applies the result as one undoable editor change. It
  also compares an editor with the script state last loaded from or saved to
  the server when the tab is closed. Changed scripts require an explicit save
  or discard decision; cancelling or a failed save leaves the editor open.
- Version `0.8.0` extends **Make pretty** with real nested indentation for
  string lists and test arguments. Editor settings control tabs or spaces,
  indentation width, compact or multiline lists and tests, and whether opening
  block braces start on the same or the next line. It also adds a global
  settings backup to the Windows application. The backup exports and restores
  all server, login, editor, appearance, and optional Sentry settings.
  Remembered passwords can be included for a portable login backup; the UI
  warns that they are readable in the JSON file, and the importer encrypts them
  for the destination operating-system user before replacing the validated
  settings.
- Version `0.8.6` adds a **Spam** tab to the Thunderbird extension and Windows
  application. It browses and searches the account's spam folder, shows raw
  headers and rule parameters, restores selected messages safely to `INBOX`,
  and can append matching allow or block rules to a selected Sieve script.
  Restoring a message appends the cleaned message before deleting its spam
  source or duplicate, and rule saving refuses duplicate or stale changes.
  **Make pretty** can now insert optional blank lines after the leading
  `require` section and complete `if`/`elsif`/`else` chains. The Windows
  **Settings** tab also shows the installed and latest GitHub release and can
  download and launch the exact release installer after validating its size
  and SHA-256 digest.
- Version `0.8.7` adds an opt-in **Make pretty** setting which sorts consecutive,
  independent top-level `if` chains alphabetically by their one unambiguous
  quoted `fileinto` destination. Leading comments and complete
  `elsif`/`else` chains move with the corresponding rule; ambiguous, nested,
  or malformed rules and intervening non-`if` statements remain in place. The
  setting is available and persisted in both the Windows application and the
  Thunderbird extension. Compact list and condition formatting can also ignore
  existing comma line breaks on request. A saved personal script can now be
  applied manually to a confirmed snapshot of non-deleted Sent messages when
  the IMAP server offers `FILTER=SIEVE`; the action verifies UIDVALIDITY,
  excludes messages arriving after confirmation, and never performs `EXPUNGE`.
- Version `0.8.8` adds an **Inbox** tab to the Thunderbird extension and Windows
  application. It lists and searches Inbox messages, opens a rule editor with
  copyable raw headers, and can lint, format, and safely append the rule to a
  selected Sieve script. Literal `fileinto` targets are checked against the
  account's IMAP folders before saving. **Make pretty** can now combine safe
  groups of equivalent sibling `if` rules into one `anyof` rule and can add
  `:create` plus the required `mailbox` capability to `fileinto` actions. Both
  transformations are opt-in and preserve comments, strings, and multiline
  text. The Windows updater now reports its current phase, byte count, and
  percentage while downloading and starting a verified installer.

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

### Migration from 0.6.1.8 and older

Versions through `0.6.1.8` used the upstream extension ID. Thunderbird cannot
change an installed extension's ID during an automatic update. Remove the old
**Sieve** extension and install `0.8.0` once; subsequent fork releases update
normally under the new ID. Do not keep both extensions installed at the same
time. Extension preferences are stored per ID, so custom Sieve connection
settings may need to be entered again after this one-time migration.

The installable package is
[`releases/sieve-0.8.8-cram-md5.xpi`](releases/sieve-0.8.8-cram-md5.xpi).

It supports Thunderbird 121 through 154. The upper compatibility limit is
required because the extension uses MailExtension Experiments and must be
verified again for each new Thunderbird major version.

SHA-256: `649f0e2e283a0650f3daf437cd2a55c383e15fbf170007c3bf8513a7adca28e6`

### Thunderbird permission notice

Thunderbird displays **Have full, unrestricted access to Thunderbird, and
your computer** because this extension includes Experiment APIs. The
privileged socket Experiment is required for the raw ManageSieve TCP
connection and STARTTLS upgrade, which the standard MailExtension APIs do not
provide. The packaged implementation does not access local files, launch
processes, or invoke a shell. Its ordinary manifest permissions cover account
and message access needed by the Spam tab, including explicit message restore,
move, import, update, and deletion operations. It also manages its tabs and
local settings and can reach `https://sentry.zp1.net/` only if the user
explicitly configures a DSN.

## Windows installer

The installable Windows package is
[`releases/install_sieve_0.8.8.exe`](releases/install_sieve_0.8.8.exe).

SHA-256: `5c61211716c6475ff339aca9dc2f71f96c5719b0c7fa73baba9558cd7193c1e8`
