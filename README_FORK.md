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

SHA-256: `a9c7fee578f89c0dcd03e287e0ddb1d5d88b1249169b0d776c41befad5e960d2`
