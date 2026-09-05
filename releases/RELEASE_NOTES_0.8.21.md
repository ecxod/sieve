## Highlights

- Fixes the Electron Inbox refresh action so it explicitly synchronizes the
  selected mailbox with the IMAP server before fetching the current messages.
- Gives the Windows application the same guarded UIDPLUS behavior as the
  Thunderbird add-on: after a successful Sieve run, only the selected
  original message is permanently removed with targeted `UID EXPUNGE`.
- Refuses to run the filter when targeted EXPUNGE was requested but the IMAP
  server does not advertise UIDPLUS.
- Opens the release's README from Thunderbird's **Release Notes** tab and adds
  a dedicated Thunderbird add-on section to that README.
- Adds a **Sieve** button to Thunderbird's unified mail toolbar. It opens the
  Sieve account overview or focuses the already open Sieve tab.
- Adds 10/20/50/100-row pagination to Inbox and Spam after searching the full
  loaded message list.
- Adds **Open**, **Reply**, and **Forward** to the Inbox context menu. The XPI
  uses native Thunderbird actions; the EXE uses dedicated message and compose
  dialogs and opens completed drafts in the default email program.

## Downloads

- `sieve-0.8.21-cram-md5.xpi`
  - SHA-256: `97980fd2df4f731379fc7beb045bd33e42178f0ed534e5f6243c6d424467e33e`
- `install_sieve_0.8.21.exe`
  - SHA-256: `4d0691872e4a0836abb8f0168e906a4ac9a77cdf66c1483045732413d361c956`
