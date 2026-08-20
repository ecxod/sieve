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

Other changes are limited to fork packaging and distribution metadata, updater
links, and the Thunderbird settings display fix.

## Thunderbird package

The installable package is
[`releases/sieve-0.6.1.3-cram-md5.xpi`](releases/sieve-0.6.1.3-cram-md5.xpi).

SHA-256: `4ae6cf15b92604437b29dfc8caba351725e03a0d1ea4d3b2a1192bbc19be838c`

## Windows installer

The installable Windows package is
[`releases/install_sieve_0.6.1.3.exe`](releases/install_sieve_0.6.1.3.exe).

SHA-256: `e1e212f364fc3f4992114cefe85594e68e82ba872f5213c828307572adc44ac9`
