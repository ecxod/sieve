# Sieve Editor CRAM-MD5 Fork

This repository contains the [`ecxod/sieve`](https://github.com/ecxod/sieve)
fork of Sieve Editor. It provides a standalone Windows application and a
Thunderbird extension for managing server-side Sieve mail-filter scripts over
ManageSieve.

The fork adds CRAM-MD5 authentication and maintains a small set of documented
usability changes. See [README_FORK.md](README_FORK.md) for the exact differences
from the upstream project.

## Thunderbird 0.7.0

Release `0.7.0` is the current Thunderbird extension release. It includes:

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

Install the current package directly:

[`releases/sieve-0.7.0-cram-md5.xpi`](releases/sieve-0.7.0-cram-md5.xpi)

SHA-256: `ed4577f1281fb99b1913277b9454d287c58874d042d24652dbf92dde743d1599`

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
