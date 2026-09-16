# @autoappz/secrets

`SecretService` (implements `SecretStore`): values are encrypted by a `Cipher` (desktop: Electron `safeStorage`) and written to `<dataDir>/secrets/<id>.bin`; metadata goes to `secret_refs`. `resolve()` is main-process only and registers the value with the `Redactor` first. When no secure backend exists the service refuses to store (`secrets.no_secure_storage`) rather than falling back to plaintext. See `docs/security/SECRETS.md`.
