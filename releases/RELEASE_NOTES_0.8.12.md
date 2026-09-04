## Highlights

- Creates missing literal `fileinto` destinations before **Run Sieve now** and
  shows the server's returned action report instead of only an aggregate count.
- Adds an Inbox **Spam** action which marks and moves the exact selected message
  to Junk and queues authenticated Rspamd analysis and training.
- Adds **Run Sieve now** and **Create Sieve Rule** to each Inbox message's
  context menu and shortens the selection-column heading to `#`.
- Uses the existing CodeMirror Sieve source editor in the Inbox rule modal, with
  syntax highlighting, line numbers, bracket matching, keyboard indentation,
  and synchronized light/dark themes.
- Keeps UIDVALIDITY and exact-message checks in place and still never performs
  an automatic `EXPUNGE`.

## Downloads

- `sieve-0.8.12-cram-md5.xpi`
  - SHA-256: `a69d8795df588f7acdc28f1b2e77b2dd97b0daa3501c7c8036e48607e05bd64a`
- `install_sieve_0.8.12.exe`
  - SHA-256: `fd4eab1dda62daa642ff6d554e87d73fb6d05ebb56175806728c37935181618a`
