# @autoappz/project

Project lifecycle (M2):

- `ProjectCatalog` — create from template, import in place or by copy, open, rename, delete. Creating/importing never executes anything from the project (test-enforced: the package does not import `child_process`). Deleting files requires a typed confirmation and is refused for in-place imports.
- Path policy — project directories must be absolute and may never be a filesystem root, the home directory, or inside the app data directory.
- `BundledTemplateSource` / `TemplateRegistry` — templates from `templates/<id>/template.json`; materializing is a filtered copy plus a `package.json` name rewrite. Generated projects have no `@autoappz/*` dependency (test + CI job).
- `BlueprintService` (versioned, approve-latest-only), `RequirementsService` (derives `REQ-nnn`/`AC-nnn` from the blueprint, preserving statuses), `ProjectMemoryService` (facts with provenance, supersede chain), `ProjectSettingsService`.
