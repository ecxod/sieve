## Highlights

- Adds an opt-in **Make pretty** setting to sort consecutive, independent
  top-level `if` chains alphabetically by their one unambiguous quoted
  `fileinto` destination.
- Moves leading comments and complete `elsif`/`else` chains together with the
  matching rule, while leaving ambiguous, nested, malformed, or interrupted
  rule groups unchanged.
- Makes the setting visible and persistent in both the Windows application and
  Thunderbird extension.
- Adds an option for compact list and condition formatting to ignore existing
  comma line breaks.
- Adds a guarded manual action for applying a saved personal Sieve script to a
  confirmed snapshot of non-deleted Sent messages on IMAP servers offering
  `FILTER=SIEVE`; it verifies UIDVALIDITY and does not perform `EXPUNGE`.

## Downloads

- `sieve-0.8.7-cram-md5.xpi`
  - SHA-256: `b9124ffa0433ffed4a9db3799a6ff5814cc7934bf1bbe40c791fe53dbf8a7104`
- `install_sieve_0.8.7.exe`
  - SHA-256: `59e76e1c833a9ff6b4c48caa2281f8fd268c668bcdb437155fb87c3e6572f358`
