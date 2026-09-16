# @autoappz/secrets

`SecretStore` backed by OS secure storage. Values are write-once from the UI, referenced by `SecretRef` everywhere else, and resolved only in main at the point of use (`docs/security/SECRETS.md`).
