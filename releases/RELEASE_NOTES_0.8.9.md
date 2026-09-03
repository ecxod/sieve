## Highlights

- Displays Inbox dates as `yyyy.mm.dd, hh:mm:ss` and sorts messages by their
  real timestamp with the newest message first.
- Adds **Run Sieve now** to the Inbox. After confirmation it applies the active
  personal Sieve script to exactly the newest message, revalidates the message
  and UIDVALIDITY, and never issues `EXPUNGE`.
- Sorts account cards on Home alphabetically by their visible name and fixes
  asynchronous Electron rendering which could previously randomize the order.
- Applies the behavior consistently in the Thunderbird extension and Windows
  application, with focused date, ordering, selection, and IMAP safety tests.

## Downloads

- `sieve-0.8.9-cram-md5.xpi`
  - SHA-256: `91e61b4368125a073689037b8e5ebe56bd60cd3bca79ee8863d9ace1338d68b0`
- `install_sieve_0.8.9.exe`
  - SHA-256: `25d419c7b77c06291e34e3d0b61a5db5a3f403d5219d36105d4fcba648149593`
