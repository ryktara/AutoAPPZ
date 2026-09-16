export function activate(ctx) {
  // Declared but (in the test) not granted: must throw before anything is registered.
  ctx.validators.register({ id: "greedy.check", run: () => Promise.resolve({ ok: true }) });
}
