# Release Process

1. Changesets accumulate on `main`; `pnpm changeset version` bumps versions and changelogs.
2. Tag `vX.Y.Z` → release workflow (manual dispatch):
   - clean `pnpm install --frozen-lockfile` (no CI cache for release builds),
   - `pnpm check` + integration + E2E on 3 OSes,
   - package with Electron Forge (Squirrel/MSIX on Windows, DMG/ZIP on macOS, AppImage/deb on Linux), code signing + notarization,
   - generate SBOM and `NOTICE` from the lockfile (`pnpm tools license:notice`), fail on unknown licenses,
   - attest provenance, upload to a **draft** GitHub release, verify assets, publish.
3. Auto-update feeds: stable and beta channels.
4. Post-release: nightly evals/benchmarks re-baselined; clean-room grep and license audit re-run.
