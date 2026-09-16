# @autoappz/plugins

Plugin SDK and in-process loader (ADR-010, ADR-016).

A plugin is a folder with `plugin.json` (id, version, displayName, entry, capabilities, minHostVersion) and a JavaScript module exporting `activate(ctx)` (and optionally `deactivate()`). `ctx` exposes only granted capabilities: `tools.register` (tools namespaced `<id>.<name>`, run through the permission engine), `validators.register`, `templates.register`, `ui.panel`. Importing `electron`, `fs`, `child_process`, networking or process modules makes the loader refuse the plugin. This is a guard rail for trusted code you chose to install, not a sandbox.

See `examples/plugins/word-count` for a complete sample and `packages/plugins/test` for the enforcement tests.
