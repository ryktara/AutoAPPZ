# @autoappz/diagnostics

Structured logging (JSON lines) with correlation ids and mandatory redaction (`docs/security/SECRETS.md`).

- `createLoggerRoot({ sinks, level })` → `Logger` with `child(scope, ids)` / `withIds(ids)`
- `Redactor` — literal secret registry + shape patterns; applied to messages, fields and errors
- `RingBufferSink` — bounded in-memory buffer for diagnostic bundles; `jsonLineSink(stream)` for files/stdout

Every sink receives already-redacted records; there is no unredacted path.
