# Sieve Editor CRAM-MD5 Fork

This repository contains the [`ecxod/sieve`](https://github.com/ecxod/sieve)
fork of Sieve Editor. It provides a standalone Windows application and a
Thunderbird extension for managing server-side Sieve mail-filter scripts over
ManageSieve.

The fork adds CRAM-MD5 authentication and maintains a small set of documented
usability changes. See [README_FORK.md](README_FORK.md) for the exact differences
from the upstream project.

## Stable release 0.8.16

**Version 0.8.16 is the latest stable release for both the Windows EXE and the
Thunderbird XPI.**

Release `0.8.16` uses the same version for the Windows application and the
Thunderbird extension. The extension includes:

- CRAM-MD5 authentication and a Thunderbird-compatible ManageSieve socket
  implementation using the current asynchronous STARTTLS API
- automatic discovery of Thunderbird IMAP and POP accounts whenever the Sieve
  server list is rendered
- an optional **Create Server** flow for standalone ManageSieve servers that do
  not correspond to a Thunderbird mail account
- safe removal of manually created server configurations without deleting mail
  accounts or server-side Sieve scripts
- a standard Thunderbird **Options** page with **I am a developer**; the
  per-server **Debugging** control stays hidden unless developer mode is enabled
- optional Sentry error reporting configured by the user on the **Options**
  page; reporting is disabled while the DSN field is empty, and the extension
  contains no hard-coded project DSN
- a **Thunderbird → Sieve** tab for each discovered mail server, showing
  Thunderbird message filters beside conservatively generated Sieve blocks
- comparison with the server's existing Sieve scripts; matching imported
  blocks are highlighted in yellow
- per-rule **Edit**, **Copy stanza**, and guarded Thunderbird-filter deletion
  controls, plus a sticky refresh/copy-all toolbar
- direct insertion into a selected existing server script, including missing
  `require` capabilities, full-script syntax validation, and protection against
  overwriting a script changed since the table was loaded; script activation is
  never changed by the importer
- a **Make pretty** action in the source editor that indents nested blocks,
  string lists, and test arguments while preserving strings, comments, and
  multiline text; editor settings control tabs/spaces, compact or multiline
  lists and tests, whether compact mode ignores existing comma line breaks,
  whether opening block braces start on a new line, and optional blank lines
  after the leading `require` section and complete `if`/`elsif`/`else` chains;
  an additional opt-in setting sorts consecutive, independent top-level `if`
  chains alphabetically by an unambiguous quoted `fileinto` destination,
  moving their comments and complete branch chains together; further opt-in
  settings combine equivalent sibling `if` rules with `anyof` and add
  `fileinto :create` plus the required `mailbox` capability
- a guarded **Apply to Sent** action which can manually apply a saved personal
  script to a confirmed snapshot of non-deleted Sent messages when the IMAP
  server offers `FILTER=SIEVE`; it verifies UIDVALIDITY, excludes messages
  arriving after confirmation, and never performs `EXPUNGE`
- a **Spam** tab for browsing, searching, and selecting messages in the
  account's spam folder; selected messages can be restored safely to `INBOX`,
  and matching allow/block rules can be inspected or appended to a chosen
  Sieve script without overwriting an independently changed script
- an **Inbox** tab with searchable messages and copyable raw headers; its
  integrated editor has synchronized graphical **Script** and **Source** tabs,
  loads message headers and generated source before connecting ManageSieve,
  and can lint, format, and safely append a rule to a chosen server script
  while checking literal `fileinto` targets against IMAP folders
  and showing possible existing rules with the same sender, domain, recipient,
  or subject in a separate read-only field;
  dates use `yyyy.mm.dd, hh:mm:ss` and are ordered newest first, and a guarded
  **Run Sieve now** action applies the active script to exactly the selected
  Inbox message without issuing `EXPUNGE`, creates missing literal `fileinto`
  destinations first, and displays the server's action report; a **Spam** action
  marks and moves the selected message to Junk and queues authenticated Rspamd
  training; both rule creation and Sieve execution are also available from the
  message context menu; when the rule editor is opened while the Sieve client
  is offline, it connects automatically before loading the target script selector
- stable, locale-aware alphabetical ordering of account cards on the Home page
- a save-or-discard warning when an editor with changes relative to the loaded
  server script is closed; cancelling or a failed save keeps the editor open
- a green success confirmation after a manual syntax check, followed by a
  gradual return to the normal button color
- a visible add-on name beside **Create Server** and the fork/version footer
  used by the Windows application

Unsupported, disabled, or semantically different Thunderbird rules are emitted
with a `false` guard and warnings for manual review rather than being silently
enabled on the server.

The Windows application additionally provides a portable settings backup. It
exports and restores server accounts, logins, editor and appearance settings,
and optional error-tracking settings. Remembered passwords are included only
after an explicit choice and a clear-text warning. The global **Settings** tab
offers **Dark**, **Dark Light**, and black **AMOLED** variants with clearer card
and button edges through a small appearance dialog. It
also contains update management which displays the installed and latest GitHub
release versions and can download, verify, and start the matching Windows
installer while showing its current phase, downloaded bytes, and percentage.
During an in-place upgrade, the Windows installer asks the user to save open
editor changes, closes a running Sieve instance, verifies that locked Electron
files can be replaced, and only then extracts the new application.

Install the current package directly:

[`releases/sieve-0.8.16-cram-md5.xpi`](releases/sieve-0.8.16-cram-md5.xpi)

SHA-256: `8de377ba5083f08f602554ca6f8814030dd475d8201c0e646699fe1347f85464`

The matching Windows installer is:

[`releases/install_sieve_0.8.16.exe`](releases/install_sieve_0.8.16.exe)

SHA-256: `831aff422c61b8f855614eab2099b03c393401860fc4206a54b5b0af808a302d`

The Thunderbird package supports Thunderbird 121 through 154. Because it uses
MailExtension Experiments, each new Thunderbird major version must be verified
before the maximum compatibility version is raised.

Versions through `0.6.1.8` used the upstream extension ID. When migrating from
one of those versions, remove the old **Sieve** extension before installing
this fork. Updates from `0.6.1.9` and newer retain the fork's extension ID.

## Downloads

The Windows installer and release artifacts are published on the
[`ecxod/sieve` Releases page](https://github.com/ecxod/sieve/releases/latest).
Checksums and package names are documented in [README_FORK.md](README_FORK.md).

## Build and test

Install the pinned dependencies and run the test suite:

```sh
npm ci
npm test
npm run lint
```

Create the Thunderbird package:

```sh
npm exec -- gulp wx:package-xpi
```

Create the graphical Linux application as a Debian/Devuan package:

```sh
npm run package-linux-deb
```

Create the Windows application directory:

```sh
npm exec -- gulp app:package-win32
```

The `gulp/` directory is required. It contains the active tasks that assemble
shared sources, package the Electron application and Thunderbird extension, and
prepare the test suite. More details are available in [BUILD.md](BUILD.md).

## Repository structure

- `src/common`: shared ManageSieve client, Sieve parser, editor, and UI
- `src/app`: Electron standalone application
- `src/wx`: Thunderbird WebExtension
- `src/web`: browser-hosted application variant
- `gulp`: build, package, and test tasks
- `tests`: test runner and shared test definitions
- `docs`: Thunderbird update manifest
- `releases`: current fork release artifacts

## Bugs and changes

Report fork-specific problems through the
[`ecxod/sieve` issue tracker](https://github.com/ecxod/sieve/issues).

## License and attribution

The source code is licensed under the
[GNU Affero General Public License v3](LICENSE.md). Third-party licensing and
the icon license are described in [LICENSING_INFO.md](LICENSING_INFO.md).
Original contributors and resources remain credited in
[CONTRIBUTORS.md](CONTRIBUTORS.md).

The upstream project is [`thsmi/sieve`](https://github.com/thsmi/sieve).
