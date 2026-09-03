## Highlights

- Adds an **Inbox** tab to the Thunderbird extension and Windows application
  with searchable messages, copyable raw headers, and an integrated Sieve rule
  editor offering lint, formatting, and safe saving to a selected script.
- Checks literal `fileinto` destinations against the account's IMAP folders and
  warns about missing or unverifiable targets before a rule is saved.
- Adds an opt-in **Make pretty** transformation that combines safe groups of
  equivalent sibling `if` rules into one `anyof` rule without moving rules
  across intervening statements or changing nested control flow.
- Adds an opt-in formatter setting that changes `fileinto` to
  `fileinto :create` and inserts the required `mailbox` capability while
  preserving comments, strings, and multiline text.
- Shows the Windows update phase, downloaded bytes, and percentage while the
  verified installer is downloaded and started.

## Downloads

- `sieve-0.8.8-cram-md5.xpi`
  - SHA-256: `649f0e2e283a0650f3daf437cd2a55c383e15fbf170007c3bf8513a7adca28e6`
- `install_sieve_0.8.8.exe`
  - SHA-256: `5c61211716c6475ff339aca9dc2f71f96c5719b0c7fa73baba9558cd7193c1e8`
