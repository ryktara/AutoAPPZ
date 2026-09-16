# @autoappz/command-bus

Runtime for the contracts in `@autoappz/contracts` (see `docs/architecture/COMMAND-BUS.md`).

- `CommandBusHost` — main-process side: one handler per contract, always-on input **and** output validation, per-request `AbortSignal`, timeouts, ordered streams, capability-token event subscriptions, untrusted-peer drop.
- `CommandBusClient` — peer side (renderer): typed `dispatch`, `stream`, `on`; knows only a `Transport`.
- `Transport` — abstract bidirectional channel. `createLocalTransportPair()` for tests / in-process mode; the Electron MessagePort transport lives in `apps/desktop`.

Nothing here imports Electron.
