# Sieve Editor CRAM-MD5 Fork

This repository contains the [`ecxod/sieve`](https://github.com/ecxod/sieve)
fork of Sieve Editor. It provides a standalone Windows application and a
Thunderbird extension for managing server-side Sieve mail-filter scripts over
ManageSieve.

The fork adds CRAM-MD5 authentication and maintains a small set of documented
usability changes. See [README_FORK.md](README_FORK.md) for the exact differences
from the upstream project.

## Stable release 0.7.3

**Version 0.7.3 is the latest stable release for both the Windows EXE and the
Thunderbird XPI.**

Release `0.7.3` uses the same version for the Windows application and the
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
- a **Make pretty** action in the source editor that formats Sieve blocks with
  tabs and line breaks while preserving strings, comments, and multiline text
- a save-or-discard warning when an editor with changes relative to the loaded
  server script is closed; cancelling or a failed save keeps the editor open
- a visible add-on name beside **Create Server** and the fork/version footer
  used by the Windows application

Unsupported, disabled, or semantically different Thunderbird rules are emitted
with a `false` guard and warnings for manual review rather than being silently
enabled on the server.

Install the current package directly:

[`releases/sieve-0.7.3-cram-md5.xpi`](releases/sieve-0.7.3-cram-md5.xpi)

SHA-256: `8225aea27bf3350fba3ddd51eb918b83708dcddb98c23d14dcfcef43c355b837`

The matching Windows installer is:

[`releases/install_sieve_0.7.3.exe`](releases/install_sieve_0.7.3.exe)

SHA-256: `59f4506d469b6517587ef5742326455bb3cc7ed6476e240b711b6ef79ff9bef1`

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
