# ecxod/sieve fork

This fork exists exclusively to add CRAM-MD5 authentication to the Sieve
client. No other functional changes have been made.

The implementation adds CRAM-MD5 to automatic SASL mechanism selection and to
the manual authentication mechanism list. It includes the HMAC-MD5 calculation
required by RFC 2195 and tests against the RFC 2195 reference exchange.

Apart from the CRAM-MD5 implementation, its tests, and the packaged XPI, the
upstream project remains unchanged.

## Thunderbird package

The installable package is
[`releases/sieve-0.6.2-cram-md5.xpi`](releases/sieve-0.6.2-cram-md5.xpi).

SHA-256: `db206754362139f270a554486c97569d5420ef6f90cb476074ce9151234d99dd`

## Windows installer

The installable Windows package is
[`releases/install_sieve_0.6.2.exe`](releases/install_sieve_0.6.2.exe).

SHA-256: `6b2902159a9f170f59738ce75559ac53f91c0a120182b2124db0debc2aa637c6`
