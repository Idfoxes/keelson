# Changelog

## 0.1.0

First public release. Beta.

### Added

- Hooks for Claude Code: prompt journal, tool-call ledger, per-turn log, context-size guard, handoff between sessions, destructive-command guard, protected records guard, reminder guard, model routing for subagents, reuse-first guard, and a Stop dispatcher that runs the quality gate, the claims check, the evidence check, the review check, the wake check and the push-first check in parallel and returns one combined block.
- Findings log with a closed list of classes, `findings.mjs stats` and `acted`, and `learn.mjs suggest`, which turns a class that repeated three times in 14 days into a candidate rule.
- Lessons: corrections stored in `~/.agent/lessons.jsonl` and added to a later prompt that matches their trigger phrases.
- Cost report by model from the ledger: `context-ledger.mjs --cost`.
- One-page local dashboard: `dashboard.mjs`.
- Project memory in git: `agent-context.mjs` creates `AGENTS.md`, `.agent/context.md`, the session log, decisions and incidents.
- Six skills: `bootstrapping-project-context`, `critic`, `goal-loop`, `production-debugging`, `project-memory`, `session-diary`.
- Three agents: `diff-reviewer`, `log-reader`, `reuse-scout`.
- Twelve rule files, in English, injected at session start.
- Codex support: `scripts/codex-hooks.mjs` wires twelve hook entries into `~/.codex/hooks.json`, and `install-codex.sh` installs the skills and the hooks.
- `/keelson:weekly-review`: a slash command that reads the week's findings, cost and corrections, then writes a report with proposed changes to `~/.agent/reviews/`. It never edits rules or settings. A sample report with invented data is in `docs/sample-weekly-report.md`.
- Documentation: `docs/ARCHITECTURE.md`, `docs/TROUBLESHOOTING.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, and a Russian README.
- CI: syntax checks for every `.mjs` and `.sh` file, JSON manifest parsing and a frontmatter check for every skill. A second job checks that every hook command points at a shipped script and runs each guard on a sample payload in a temporary `HOME`: it must exit 0, print nothing or valid JSON, and the destructive-command guard must ask before a force push.

### Known limitations

- Developed and tested on macOS and Linux. Windows is untested.
- The dashboard has sections for data this package does not write; they show an empty state.
- The files under `~/.agent` are not rotated.
- Secret masking is pattern based and best effort.
- The Codex side has had much less use than the Claude Code side.
- No benchmark numbers are published yet.
