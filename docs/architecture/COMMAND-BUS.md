# Command Bus (`packages/command-bus`, `packages/contracts`)

## Definitions (in `contracts`)
```ts
export const projectCreate = defineCommand({
  name: "project.create",
  input: z.object({ name: z.string().min(1).max(80), templateId: z.string(), location: z.string().optional() }),
  output: z.object({ projectId: z.string(), path: z.string() }),
  invalidates: ["projects"],
});
export const taskStream = defineStream({ name: "task.stream", input: z.object({ taskId: z.string() }), chunk: TaskEventSchema });
export const runtimeStateChanged = defineEvent({ name: "runtime.stateChanged", payload: RuntimeStateSchema });
```

## Envelope
Request `{ id, name, sessionId, projectId?, requestId, issuedAt, input }`; response `{ id, ok: true, value } | { id, ok: false, error: AppError }` where `AppError = { kind, code, message, details?, retryable, correlationId }` and `kind ∈ validation | not_found | permission | conflict | precondition | cancelled | timeout | external | internal`.

## Guarantees
- Input validated at dispatch and on receipt; output validated before send.
- Every handler receives `{ signal, ids, actor }`; `bus.cancel(id)` aborts.
- Streams: `{ streamId, seq, kind, payload }`; consumers keep `lastSeq`; high-volume streams batch (≤50 ms) and honor ack windows.
- Events are fanned out only to windows with an active subscription token; the bus tracks interest per entity for cleanup.
- Invalidations are declared on commands and delivered as `cache.invalidate` events with scopes.
- No secret values in any payload (contract lint: fields named `apiKey|token|secret|password` must be `SecretRef`).

## Transport adapters
`ElectronIpcTransport` (default) and `WebSocketTransport` (future) implement `{ send, onMessage }`; the bus is transport-agnostic.

## Testing
`createTestBus()` runs handlers in-process; contract tests generate valid/invalid inputs from schemas; a registry test asserts every declared contract has exactly one handler.
