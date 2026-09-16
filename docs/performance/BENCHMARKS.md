# Performance Benchmarks — Methodology, Targets and Measured Baseline

Run locally with `pnpm bench` (indexing, retrieval, search, memory on a synthesized 2k-file TypeScript app) and `pnpm bench:startup` (Electron launch to interactive, built bundle required). The nightly `bench.yml` workflow runs both on ubuntu/windows/macos, uploads `tools/bench/results/*.json`, and fails when a number exceeds `tools/bench/targets.json` or regresses more than 10 % against the committed `tools/bench/baseline.json`.

## Measured baseline (2026-09-16, Windows 11, x64, Node 24, `pnpm bench` twice on a busy workstation)

| Benchmark | Fixture | Measured p50 / p95 | Target p50 / p95 | Status |
|---|---|---|---|---|
| Repository indexing (cold) | synthesized 2k-file app (2 000 modules + 500 components + 200 tests) | 4.1–7.1 s / 5.6–7.1 s across runs | 8 s / 20 s (re-baselined from 5 s: heuristic parsers + FTS5 inserts cost ≈2–3.5 ms/file; the UI stays usable because indexing yields every 25 files) | met |
| Incremental reindex | one changed file in the 2k app, 50 samples | 2.4–4.1 ms / 3.4–14.4 ms | 100 ms / 250 ms | met |
| Context construction | `retrieve()` with a 30k-token budget, 50 queries | 22–41 ms / 27–69 ms | 300 ms / 700 ms | met |
| File search | `search.text` via ripgrep, 20 queries after one warm-up call | 141–151 ms / 200 ms | 200 ms / 500 ms | met (the very first ripgrep launch on Windows took ≈5 s once; excluded as process cold start, documented here) |
| Memory | RSS of the bench process after indexing 2k files | 126–131 MB | main < 400 MB | met |
| Retrieval quality | fixture suite in `packages/context/test` (10 labelled tasks) | recall@6k ≥ 0.9 asserted | recall ≥ 0.9 | met (100-query suite deferred) |
| Repair loop | injected-error suite in `packages/core/test` (6 cases + bounded-attempt case) | 100 % recovered, 1 round each | ≥ 95 %, mean rounds ≤ 1.5 | met (40-case suite deferred) |
| First model token | `packages/core/test` best-of-3 overhead with the fake provider | < 300 ms asserted | ≤ 300 ms | met |
| Startup to interactive | `pnpm bench:startup`, 10 cold + 10 warm launches | collected by the nightly job (no committed baseline yet) | 1.5 s / 2.5 s cold; 0.8 s / 1.5 s warm | UNVERIFIED locally |
| Project open, preview startup, dependency install, build | — | not automated; e2e `runtime.spec` exercises install + dev server on the react-vite template (≈30–60 s end to end with a warm pnpm store) | see table in the previous revision | UNVERIFIED |
| 10k-file monorepo fixtures | — | not generated yet | — | deferred |

Rules stay as before: measure before optimizing; every optimization PR links a benchmark delta; regressions > 10 % fail the nightly job. Numbers above come from a developer workstation and are the floor for CI targets, not a promise for every machine.
