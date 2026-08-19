# ecxod/sieve fork

This fork exists to provide a Sieve build with CRAM-MD5 authentication for
Thunderbird and Windows distribution from `ecxod/sieve`.

The implementation adds CRAM-MD5 to automatic SASL mechanism selection and to
the manual authentication mechanism list. It includes the HMAC-MD5 calculation
required by RFC 2195 and tests against the RFC 2195 reference exchange.

Apart from the CRAM-MD5 implementation, its tests, and the minimal fork
maintenance needed to package and distribute this variant from the fork
(release metadata, updater links, and the Thunderbird settings display fix),
the upstream project remains unchanged.

## Thunderbird package

The installable package is
[`releases/sieve-0.6.1.1-cram-md5.xpi`](releases/sieve-0.6.1.1-cram-md5.xpi).

SHA-256: `b8617d537d1eb61845fa22318acda624be39fd4c94948cd757dfcc082083d587`

## Windows installer

The installable Windows package is
[`releases/install_sieve_0.6.1.1.exe`](releases/install_sieve_0.6.1.1.exe).

SHA-256: `7251bc4f7445d50e787636d1b2c8e9de393005a4bfabc0d26049497fe88a48bb`
