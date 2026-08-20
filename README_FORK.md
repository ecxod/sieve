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

Other changes are limited to fork packaging and distribution metadata, updater
links, and the Thunderbird settings display fix.

## Thunderbird package

The installable package is
[`releases/sieve-0.6.1.2-cram-md5.xpi`](releases/sieve-0.6.1.2-cram-md5.xpi).

SHA-256: `7f9388174268906e4ea8a72e38db82f4eb96c1e4791c3a926b5ff4a503813bae`

## Windows installer

The installable Windows package is
[`releases/install_sieve_0.6.1.2.exe`](releases/install_sieve_0.6.1.2.exe).

SHA-256: `9b1337dac0f01150325d1c2ebf0ca10ccbd8458607d04c1c3d866387d9d0f64e`
