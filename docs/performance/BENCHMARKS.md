# Performance Benchmarks — Methodology and Targets

No numbers are claimed until measured by `pnpm bench` in CI (nightly on ubuntu/windows/macos, results committed as JSON under `tools/bench/results/` and trended). Targets are initial hypotheses to be re-baselined with evidence.

| Benchmark | Method | Fixture | Target (p50 / p95) |
|---|---|---|---|
| Startup to interactive | Electron launch → first `workspace.ready` event; 10 cold runs | fresh profile; profile with 50 projects | 1.5 s / 2.5 s (cold), 0.8 s / 1.5 s (warm) |
| Project open | `project.open` → catalog + last session rendered | 50-project catalog | 300 ms / 600 ms |
| Repository indexing (cold) | `context.ensureIndexed` on fixture repos | 300-file Vite app; 2k-file Next app; 10k-file monorepo | 5 s / 20 s / 90 s (background; UI usable immediately) |
| Incremental reindex | single file change → index updated | 2k-file app | 100 ms / 250 ms |
| Context construction | `context.retrieve` with 30k budget | 2k-file app, 50 queries | 300 ms / 700 ms |
| File search | `search.text` (ripgrep) 20 queries | 10k-file monorepo | 200 ms / 500 ms |
| First model token | submit → first delta (fake provider with 0 latency) | — | overhead ≤ 300 ms |
| Preview startup | `runtime.start(serve)` → health OK | template app, warm `node_modules` | 3 s / 6 s |
| Dependency install | `runtime.start(install)` | template app, warm pnpm store | 15 s / 40 s |
| Build | `runtime.start(build)` | template app | 20 s / 45 s |
| Memory | RSS of main + workers after 30 min of a scripted session | 2k-file app | main < 400 MB; index worker < 512 MB |
| Repair loop | injected-error suite | 40 cases | success ≥ 95%, mean rounds ≤ 1.5 |
| Retrieval quality | recall@budget / precision | 100 labeled queries | recall ≥ 0.9 |

Rules: measure before optimizing; every optimization PR links a benchmark delta; regressions > 10% fail the nightly job.
