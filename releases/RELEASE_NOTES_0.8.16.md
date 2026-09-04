## Highlights

- Fixes the Inbox rule modal showing empty message-header, similar-rule and
  generated-rule areas.
- Loads the selected message headers and generated source independently before
  connecting to ManageSieve, so a connection error no longer blanks the modal.
- Adds synchronized **Script** and **Source** tabs to the rule editor, matching
  the two useful views of the full Sieve editor.
- Enables the generated rule's required capabilities inside the graphical
  parser so `fileinto :create` templates render as editable graphical blocks.
- Keeps the source view available and displays an actionable error if the
  graphical editor or server connection fails.
- Shows explicit loading, empty and error text instead of unexplained blank
  read-only fields.

## Downloads

- `sieve-0.8.16-cram-md5.xpi`
  - SHA-256: `8de377ba5083f08f602554ca6f8814030dd475d8201c0e646699fe1347f85464`
- `install_sieve_0.8.16.exe`
  - SHA-256: `831aff422c61b8f855614eab2099b03c393401860fc4206a54b5b0af808a302d`
