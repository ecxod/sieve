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

These differences are maintained alongside the fork packaging and distribution
metadata, updater links, and the Thunderbird settings display fix.

## Repository scope

Unused upstream infrastructure has been removed from the fork: Azure pipelines,
the development-only `tools` collection, obsolete editor and service
configuration, and stale upstream planning and governance documents. The
`gulp` directory remains because it contains the active build, packaging, and
test tasks for the Windows application, Thunderbird extension, and shared code.

## Thunderbird package

The installable package is
[`releases/sieve-0.6.1.4-cram-md5.xpi`](releases/sieve-0.6.1.4-cram-md5.xpi).

SHA-256: `9ea7daa7f3fe8525ffb13db6764c9a9a4b570b4cebc8a1e626cb7f4f41f27fb1`

## Windows installer

The installable Windows package is
[`releases/install_sieve_0.6.1.4.exe`](releases/install_sieve_0.6.1.4.exe).

SHA-256: `8fffc520c45972f71b164bf548532dff68610573da1aa6427a34b99ccc3b6638`
