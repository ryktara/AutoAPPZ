# Personas

## Maya — the Maker
Founder of a two-location restaurant. No coding background; has tried no-code builders and hit walls at "real" features (reservations, admin, payments). Wants: "build me the whole thing", clear progress, one obvious next action when something breaks, a deployable result she owns. Fears: getting stuck in terminals, losing work, surprise bills.

**Design implications:** blueprint questionnaire in product language; scope confirmation ("here is what a complete restaurant platform includes — keep/remove"); validation results as plain outcomes ("Reservations page works: 5 checks passed"); cost shown per task; deploy checklist.

## Dev — the Builder
Indie developer with API keys and a local Ollama. Iterates fast, wants diffs, tests, git, and the freedom to open the project in VS Code at any time. Distrusts magic.

**Design implications:** Changes pane with real diffs, Validation pane with raw output available, git branches visible, permission scopes, provider/model override per task, usage dashboard.

## Priya — the Engineer
Senior engineer applying the agent to an existing 5k-file repository. Needs conflict-safe edits, respect for the repo's lint/test setup, no copying of the repo, container runtime for untrusted dependencies, audit of what ran.

**Design implications:** import in place; read-before-write and hash checks; runs the project's own scripts; container profile; audit log export; plugin/MCP capabilities explicit.

## Tom — the Reviewer / Lead
Reviews what the agent did last week. Needs task records with plan, criteria matrix, evidence and checkpoints.

**Design implications:** Task history view; criteria matrix with evidence links; diagnostics bundles; checkpoint compare.
