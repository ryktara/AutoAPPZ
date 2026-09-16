# Release Process

Implemented by `.github/workflows/release.yml` (tag `vX.Y.Z` or manual dispatch).

1. **Versioning.** Changesets accumulate on `main` (`pnpm changeset`); `pnpm changeset version` bumps versions and changelogs before tagging.
2. **Verify** (ubuntu): clean `pnpm install --frozen-lockfile` with no dependency cache, `pnpm check` (typecheck, lint, format, unit + security suites), clean-room grep, and `node tools/license-notice.mjs --check`, which regenerates `NOTICE-THIRD-PARTY.md` and `sbom.cdx.json` (CycloneDX 1.5) from the lockfile and fails on unknown or copyleft-incompatible licenses.
3. **Package** (ubuntu, windows, macos): `electron-forge make` with the makers in `apps/desktop/forge.config.ts` — ZIP everywhere, Squirrel installer on Windows, DMG on macOS, `.deb` on Linux. Electron fuses stay on (no RunAsNode, no NODE_OPTIONS, no CLI inspect, asar integrity, only-load-from-asar).
   - **Signing** is configured from CI secrets only: `MAC_CERT_P12_BASE64`/`MAC_CERT_PASSWORD` + `APPLE_ID`/`APPLE_APP_PASSWORD`/`APPLE_TEAM_ID` enable macOS code signing and notarization; `WIN_CERT_PFX_BASE64`/`WIN_CERT_PASSWORD` enable Windows Authenticode. Without them the workflow still produces unsigned artifacts so the pipeline can be exercised on forks. **UNVERIFIED:** signing has not been executed with real certificates in this repository; the first tagged release with secrets configured is the validation step (check Gatekeeper on macOS and SmartScreen on Windows).
   - **Provenance:** every artifact is attested with `actions/attest-build-provenance` (SLSA build provenance, verifiable with `gh attestation verify`).
4. **Draft release.** Artifacts from all platforms plus the notices are attached to a **draft** GitHub release with generated notes; a human verifies assets and publishes.
5. **Post-release.** The nightly benchmark workflow (`bench.yml`) re-baselines `tools/bench/baseline.json` when targets move; clean-room grep and the license audit run again on the next verify.

Auto-update feeds (stable/beta) are not implemented yet; releases are manual downloads.
