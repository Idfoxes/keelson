## Quality gate

At the end of a turn that changed code, `quality-gate.mjs` runs fast checks on the changed files: the `turn_checks` commands from `.agent/project.yaml` (with `{files}`), otherwise the linter and affected tests it finds. It also flags junk files and new code comments.

- A failure blocks the turn. Fix the cause and end the turn again.
- A test that already failed before your change, or that needs a database or network, is reported with its output. Never present it as a pass.
- Before saying "done", run the full `checks` list from `.agent/project.yaml` after the last edit. The gate stops "done" otherwise.
- Put drafts, reports and measurements in `.agent/scratch/` or `/tmp`, never in the repository root.
