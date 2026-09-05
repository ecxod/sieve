## Highlights

- Fixes Thunderbird 121+ Inbox listing by passing the required folder ID and
  synchronizes the Inbox with the IMAP server when it is refreshed.
- Makes **Run Sieve now** reconnect ManageSieve when needed, resolve the IMAP
  host and Inbox path reliably, create literal `fileinto` destinations, and
  apply the active script to exactly the selected message.
- Uses UIDPLUS to expunge only the selected original after the Sieve rule has
  been applied successfully.
- Reconnects ManageSieve automatically before saving an Inbox-created rule.
- Shows each possible similar existing `if` rule in its own read-only source
  field with script name, line, matching criteria, and **Load into editor**.
- Loading an existing rule selects its originating Sieve script and displays
  its first literal `fileinto` target. Saving replaces only the exact unchanged
  source range instead of appending a duplicate.
- Clarifies the Inbox rule controls and labels, removes the redundant execution
  confirmation, and labels cancel actions consistently.
- Improves Thunderbird socket diagnostics and fixes malformed proxy URIs for
  literal IPv6 addresses.

## Downloads

- `sieve-0.8.20-cram-md5.xpi`
  - SHA-256: `1693ebe3cfd0c36d3e2fcb9b909a46c69ae83b80b0f3cf8ba8723181bc63cf88`
- `install_sieve_0.8.20.exe`
  - SHA-256: `6886b089609eaf4744165cb932900a6e31a796fb87b09217870bfaa550496ecc`
