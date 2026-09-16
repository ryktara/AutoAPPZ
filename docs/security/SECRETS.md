# Secrets

One secrets service (`packages/secrets`).

## Classes
- **Platform secrets**: provider API keys, OAuth tokens (VCS, DB, deploy), MCP server credentials.
- **Project secrets**: values the user asks AutoAPPZ to manage for a project (e.g., a database URL the platform provisioned) — stored by reference, materialized only into the project's own `.env.local` when the user requests it.
- **Generated-app `.env` files**: owned by the project; never read into model context except through the redacting `env.read` tool with explicit permission; never logged.

## Storage
OS keychain via Electron `safeStorage` (Keychain / DPAPI / libsecret) with an explicit **refusal to fall back to plaintext** unless the user opts in via a visible setting ("This machine has no keyring; store secrets encrypted with a passphrase instead"). Alternative: passphrase-derived key (scrypt) file-based vault. Values are addressed by `SecretRef {id}`.

## Rules
- Secrets never cross the command bus; contracts use `SecretRef`.
- Never logged: redaction middleware scans log lines, error messages, telemetry, diagnostic bundles and model context for known secret values and common token shapes.
- Tool invocations that need a secret receive it through `ctx.secrets.use(ref)` inside the main process, only if the tool's permission includes `secrets.use` and the policy allows.
- Rotation and revocation update refs; old values are wiped.
- Tests: fixture secret values must never appear in any renderer payload, log, prompt snapshot or bundle (CI scan).
