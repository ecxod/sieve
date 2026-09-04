## Highlights

- Fixes in-place Windows upgrades failing with errors such as
  `Can't write: ...\chrome_100_percent.pak` while Sieve is running.
- Warns the user to save open editor changes before an upgrade closes Sieve.
- Uses the Windows Restart Manager and a targeted `sieve.exe` process fallback,
  then verifies that both the executable and Chromium resource pack can be
  replaced before extraction begins.
- Shows a Retry/Cancel error instead of continuing with a partial installation
  if another process still holds an application file open.
- Keeps the NSIS source used for the release in the repository so future
  installers use the same reviewed upgrade behavior.

## Downloads

- `sieve-0.8.15-cram-md5.xpi`
  - SHA-256: `31810e3d8515890473c18646ab210ed305da424a3dc6b00fb2ade10d3645a4e8`
- `install_sieve_0.8.15.exe`
  - SHA-256: `fb890a63d721d04e1aef71bb9c94220b0d9a66e8ced5a4e28b53933a73893f41`
