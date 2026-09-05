## Safety fix

- Removes the implicit `INBOX` destination from **Create Sieve Rule**.
- Requires an explicit destination mailbox before generating a `fileinto`
  rule or enabling Lint and Save.
- Lets users choose an existing mailbox from the account list or enter a new
  mailbox name directly.
- Keeps `fileinto :create` for a newly entered destination so a capable server
  can create it on the first matching delivery.
- Replaces the ambiguous template wording with **Use destination mailbox**.
- Explains in the dialog that saving appends the rule to the selected Sieve
  script and does not overwrite `INBOX` or another mail folder.

## Downloads

- `sieve-0.8.19-cram-md5.xpi`
  - SHA-256: `2c63582536c632fe6493bad1f76e90bd87ae3f8857cdb73e8c3840247804b092`
- `install_sieve_0.8.19.exe`
  - SHA-256: `962d6ae0f403fe9d662dc437cfe4efd9dd9654bb3a4d15ab5cfd1a22eabc7442`
