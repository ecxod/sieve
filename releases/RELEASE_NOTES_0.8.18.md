## Highlights

- Fills the Inbox rule editor's target-script selector before inspecting every
  script body.
- Loads the active script first and enables Lint/Save only after the selected
  script body is available.
- Removes the non-canceling overall 20-second timer which could leave later
  source requests waiting behind abandoned script inspection work.
- Stops queuing further inspection requests after the rule modal is closed and
  reports individual script failures without emptying the selector.
- Adds a visible **Close** button beside **Settings** in the Windows app.
- Uses the same orderly shutdown for the new button and the native window close
  control: check open editors, disconnect ManageSieve sessions, then exit.

## Downloads

- `sieve-0.8.18-cram-md5.xpi`
  - SHA-256: `1be7d036f29bb7b10b06c3e1ee95d1549f26e3a0efcfbc21bebe65987e4cfa81`
- `install_sieve_0.8.18.exe`
  - SHA-256: `4da69bed899339af2c84d483cd1b87f358250b06c2d00524a5f20465575981ea`
