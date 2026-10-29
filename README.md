# Keelson

[![license](https://img.shields.io/github/license/Idfoxes/keelson)](LICENSE)
[![ci](https://img.shields.io/github/actions/workflow/status/Idfoxes/keelson/ci.yml?branch=main&label=ci)](https://github.com/Idfoxes/keelson/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/tag/Idfoxes/keelson?label=version)](CHANGELOG.md)

**Install it with your agent.** Open Claude Code and send this:

```
Install https://github.com/Idfoxes/keelson and set it up.
```

The agent reads [AGENTS.md](AGENTS.md), installs the plugin and tells you to open one new session, where `/keelson:setup` checks everything and schedules a weekly review (Monday 09:00 local time, one removable cron line).

Manual install, if you prefer:

```
/plugin marketplace add Idfoxes/keelson
/plugin install keelson@keelson
```

---

Coding agents repeat the same mistakes, and a correction you gave on Monday is gone by Wednesday. Spend hides in re-reading context, and nothing in the chat shows it.

Keelson is a local-first harness for Claude Code and Codex. It records every turn and tool call on your machine, runs quality gates when a turn ends, and once a week turns the evidence into rule changes that you accept or drop. It is hooks, scripts, skills and plain files: no server, no account, no telemetry.

Status: beta, version 0.1.0 ([what is rough](#status-and-limits)). Russian version: [README.ru.md](README.ru.md).

## What you get

```
$ node <plugin-dir>/scripts/context-ledger.mjs --cost --days 7

EXAMPLE OUTPUT. The shape is real, the values are placeholders.
In 7 days, resending context on tool calls: <amount> at cache-read prices, <n> sessions.
By model: opus <amount>, calls <n>; sonnet <amount>, calls <n>; haiku <amount>, calls <n>
Reads and searches on an expensive model: <amount> (<share> %). Candidate for a Haiku subagent.

  <amount>  a41f09c2  webapp        calls <n>, average context <k>
  <amount>  7c20be11  billing-api   calls <n>, average context <k>

$ node <plugin-dir>/scripts/findings.mjs stats --days 7

EXAMPLE OUTPUT. The shape is real, the values are placeholders.
Findings: <n>, high <n>, per 1000 lines <x>
  contract         <n>  <share> %
  test-gap         <n>  <share> %
  terms            <n>  <share> %

$ node <plugin-dir>/scripts/dashboard.mjs --no-open
Written: ~/.agent/dashboard.html
```

The dashboard is one self-contained HTML page with requests per day, the longest sessions, questions you keep asking, lessons, findings by class, the most expensive sessions and what brought the most tokens into the last session.

- **Records.** Every prompt (redacted), turn and tool call is written to plain files under `~/.agent`. You can see where the tokens went and what you keep correcting.
- **Gates.** When a turn ends, one dispatcher runs the quality gate, a check of claims against the action log, a check for evidence, a review check, a wake check and a push-first check. Dangerous commands and edits to protected files are stopped before they run.
- **Weekly review.** The command `/keelson:weekly-review` reads the week's data and writes a report with proposed lessons and rules, each with its evidence and a ready command. It changes nothing by itself.

## Observations from one user

The design came from one person's own logs over weeks of daily work. These are observations, not controlled experiments, and your data will differ.

- **Finished sessions kept spending.** A large share of model turns in the week measured ran in sessions that had already handed their work off to a new session. Old sessions were woken by their own reminders, background notifications and messages from child sessions, and answered that the continuation was already running.
- **Compaction in place ended the chaining.** After compaction at a fixed context size was switched on (the Claude Code setting `autoCompactWindow`, which Keelson does not change for you), the nudges to continue after a handoff stopped.
- **Worker subagents started heavy.** A worker subagent without a declared tool list started with a much larger context than one with a declared list, and the start context is resent on every request it makes.
- **A shared record file cost fix-up commits.** Project records that task branches must not edit (context, decisions, session log) were edited on task branches, and many of the commits that touched them only restored them. The check ran after the commit. A hook now refuses the edit before it happens.

## Quickstart

Requirements: Claude Code with plugin support, Node 18 or newer, git. Developed and tested on macOS and Linux. Windows is untested.

Install as above and start a new session. Work as usual. After a few prompts, look at the first data. `<plugin-dir>` is the folder Claude Code installed the plugin into (under `~/.claude/plugins/`), or `plugins/keelson` inside a clone of this repository.

```
node <plugin-dir>/scripts/dashboard.mjs --no-open
```

This writes `~/.agent/dashboard.html`, a page about the last 7 days (`--days N` changes the period). Without `--no-open` it opens the page with the macOS `open` command. Some sections show an empty state because they read data that this package does not write.

Commands you will use:

```
node <plugin-dir>/scripts/context-ledger.mjs --cost --days 7
node <plugin-dir>/scripts/context-ledger.mjs --report --last
node <plugin-dir>/scripts/findings.mjs stats --days 7
node <plugin-dir>/scripts/findings.mjs acted --days 14
node <plugin-dir>/scripts/learn.mjs suggest --days 14
node <plugin-dir>/scripts/lessons.mjs list
node <plugin-dir>/scripts/recall.mjs "what I am looking for"
node <plugin-dir>/scripts/handoff.mjs show
```

In order: the cost of resending context by model and session; what brought tokens into the last session; review and gate findings by class; how many findings were followed by an edit; the finding classes that repeated three times in 14 days in one repository and are candidates for a rule; stored lessons; a search over your own journal, handoffs, findings, lessons and decision records; the last handoff note for the current repository.

To record a correction so that it comes back at the right moment, run:

```
node <plugin-dir>/scripts/lessons.mjs add "Run the migration test before the whole suite" --when "fix the migration; migration" --evidence "what you said"
```

Add `--global` for a lesson that holds in every repository. When a later prompt shares words with `--when` (matching is by word stems, so use distinctive words), the hook adds the lesson to that turn.

To give a repository project memory in git (`AGENTS.md`, `.agent/context.md`, a session log, decisions, incidents, a code map):

```
node <plugin-dir>/scripts/agent-context.mjs init
```

`agent-context.mjs check` verifies the budgets and flags strings that look like secrets.

## Weekly review

The hooks collect the data all week. The review turns it into decisions. Run it once a week in Claude Code:

```
/keelson:weekly-review
```

The command runs `findings.mjs stats --days 7`, `findings.mjs acted`, `learn.mjs suggest --days 14` and `context-ledger.mjs --cost --days 7`, reads last week's report from `~/.agent/reviews/` if there is one, checks what happened to its proposals, and writes `~/.agent/reviews/<date>.md`:

- what happened to last week's proposals;
- the top cost drivers;
- the finding classes that repeated;
- up to five proposed changes, each with an evidence line and a ready command (`lessons.mjs add ...`, or the JSON of a rule in shadow mode);
- a list of things it looked at and recommends leaving alone.

The command is limited to `node`, Read and Write. It never edits rules, settings or repository files. You read the report and run the commands you agree with. [docs/sample-weekly-report.md](docs/sample-weekly-report.md) shows the format with invented data. You can also run the command from a scheduled task of your own.

## What it writes and where

Everything is a plain file on your machine.

| Path | Content |
|---|---|
| `~/.agent/journal/YYYY-MM.jsonl` | Every prompt, redacted, at most 400 characters |
| `~/.agent/turns.jsonl` | One row per finished turn: time, session, repository, context size, last 200 characters of the answer (redacted) |
| `~/.agent/context-ledger/<session>.jsonl` | One row per tool call: tool, target (file path or the first 60 characters of the command), tokens returned, context size, model |
| `~/.agent/findings.jsonl` | Review and gate findings with class, severity, `file:line`, evidence |
| `~/.agent/lessons.jsonl` | Corrections you recorded, with trigger phrases and a confirmation count |
| `~/.agent/handoff/` | Handoff notes between sessions, one per repository |
| `~/.agent/hook-runs.jsonl` | One row per guard run with its outcome |
| `~/.agent/denials.jsonl` | Permission denials with the classifier's reason |
| `~/.agent/board/` | One card per session |
| `~/.agent/reviews/` | Weekly review reports |
| `~/.agent/dashboard.html` | The generated page |
| `~/.agent/*.json`, `trusted-repos.txt` | Small state files of the guards |
| `<repo>/AGENTS.md`, `<repo>/.agent/` | Project memory in git: context, session log, decisions, incidents, code map. Created by `agent-context.mjs init`, meant to be committed |

Nothing rotates the logs in 0.1.0.

## What each hook does

Sixteen hook entries, all from `plugins/keelson/hooks/hooks.json`. Each one is a single `node` process. A guard that has nothing to say prints nothing and costs no context.

| Event | Script | What it does |
|---|---|---|
| UserPromptSubmit | `journal.mjs` | Appends the redacted prompt to the journal. Prints nothing |
| UserPromptSubmit | `context-guard.mjs` | Warns at 120k tokens of context, at 260k asks for a handoff and a new session. Silent below 120k |
| UserPromptSubmit | `lessons.mjs` | Adds a stored lesson to the turn when your prompt matches its trigger phrases. Silent otherwise |
| SessionStart | `build-policy.mjs --hook` | Injects the rule files at startup, clear and compact |
| SessionStart | `handoff.mjs` | At startup and clear injects the handoff for the same branch, the project context from `.agent/context.md` (within 6,000 characters) and the last log entry. After compaction it injects the project context again |
| SessionEnd | `agent-context.mjs session-end` | If the session changed files or committed and the agent wrote no log entry, appends an automatic one |
| PostToolUse | `context-ledger.mjs` | Writes one ledger row per tool call. Warns when the same call repeats five times in a row |
| PermissionDenied | `permission-denied.mjs` | Logs the denial and the classifier's reason, allows up to three retries in ten minutes |
| PreToolUse | `protect-guard.mjs` | Refuses edits to `.agent/context.md`, `.agent/log.md` and `.agent/decisions.md` on task branches, and to paths listed in `.agent/protected` |
| PreToolUse | `cron-guard.mjs` | Refuses recurring reminders that fire more often than every 30 minutes |
| PreToolUse | `destructive-guard.mjs` | Asks before commands that delete or overwrite data (recursive `rm`, storage deletes, `kubectl delete` outside a test namespace, `docker prune`, force pushes, hard resets) and denies reading secrets out of the keychain |
| PreToolUse | `model-route.mjs` | Sends search and read tasks of a general-purpose subagent to Haiku, and asks for an explicit model on the rest |
| PreToolUse | `reuse-guard.mjs` | Stops the first new code file or function until a `reuse-scout` search ran in the last 30 minutes |
| Stop | `turn-log.mjs` | Writes the turn row and refreshes the session card. Never blocks |
| Stop | `stop-dispatch.mjs` | Runs six checks in parallel and returns one combined block, listed below |

The dispatcher runs `quality-gate.mjs` (lint, syntax and affected tests for the files changed in the turn, stray files, new comments if your project forbids them), `claims-guard.mjs` (claims in the final answer against the action log: "tests pass" needs a test run in the turn), `stop-evidence-guard.mjs` (a link after a push, "done" with no check after an edit), `review-guard.mjs` (a review by a fresh subagent before "done" after more than 50 changed lines), `wake-guard.mjs` ("I will continue myself" with nothing that can wake the session) and `push-first-guard.mjs` (replies that wait for a full test run when a push could go first). A block costs one extra model turn, so they arrive as one block. How it fits together is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The package also ships 12 rule files (injected at session start), six skills (`bootstrapping-project-context`, `critic`, `goal-loop`, `production-debugging`, `project-memory`, `session-diary`) and three subagents (`diff-reviewer`, `log-reader`, `reuse-scout`).

## Overhead

- **Hooks.** 16 entries. Per event: UserPromptSubmit 3, SessionStart 3 (two run on startup and clear, two on compact), SessionEnd 1, PostToolUse 1 (every tool call), PermissionDenied 1, PreToolUse 5 (filtered by matcher, a Bash call triggers two), Stop 2.
- **Run time on a quiet machine.** Measured on a Linux VM with Node 22 and a small repository, median of 20 runs: 14 to 23 ms per hook against 11 ms for a bare `node -e 0`. The Stop dispatcher with all six checks: 60 ms.
- **Run time in daily use.** The Stop dispatcher and the quality gate log their run time to `hook-runs.jsonl`, so you can read your own numbers. The tail comes from the gate running affected tests. Its budget is 60 s (`KEELSON_GATE_BUDGET_MS`) and the dispatcher times out at 100 s. The other hooks do not log their run time.
- **Injected context.** The 12 rule files are about 7.5 KB (7,435 bytes), injected once at startup, clear and compact; by a rough estimate of 4 characters per token that is about 1,900 tokens. It was not measured with a tokenizer. The handoff and project context add at most 6,000 characters of project context plus the handoff note (up to 40 lines): 1,961 characters in a small test repository, nothing when there is no `.agent/context.md` and no handoff. Per prompt nothing is added unless a lesson matches or the context passes 120k tokens.

## Privacy

Everything stays on your machine. The hooks and scripts open no network connections. Your agent talks to its provider as it always did; Keelson adds nothing to that traffic except the text of the rules, lessons and handoffs it injects into the session.

`lib/redact.mjs` masks secrets before text is written, with patterns: private key blocks, known token formats, passwords in URLs, `NAME=value` for names that contain PASSWORD, SECRET, TOKEN or API_KEY, values after labels such as `AK:` or `password:`, email addresses, IPv4 addresses, internal-looking host names, secret URL parameters and hexadecimal strings of 32 characters or more. It runs on prompts (journal), the tail of each answer, finding evidence, denial reasons, and the command text in the hook run log and the ledger. The ledger keeps long hexadecimal strings so that commit hashes stay readable.

What it does not cover: file paths, anything an agent or you write into handoff notes, lessons and `.agent/` files, and any secret that does not match a pattern. Redaction is best effort, not a guarantee. `agent-context.mjs check` flags strings in `.agent/` that look like secrets. The files are created with your default umask; `chmod -R go-rwx ~/.agent` limits them to you. Do not commit `~/.agent`. More in [SECURITY.md](SECURITY.md).

## Codex

What works today, wired by `install-codex.sh`:

- **Hooks.** Twelve hook entries from eight scripts in `~/.codex/hooks.json`: `journal.mjs`, `destructive-guard.mjs` (twice), `quality-gate.mjs`, `claims-guard.mjs`, `stop-evidence-guard.mjs`, `turn-log.mjs`, `wake-guard.mjs` and a probe `codex-probe.mjs` (four entries) that records which events fire. Your other hooks and their order are left alone. Codex asks you to trust new hooks: approve them or they will not run. The probe showed that SessionStart, PreToolUse, PostToolUse and Stop fire.
- **Skills.** The six skills are copied to `~/.agents/skills`.
- **AGENTS.md.** `node <plugin-dir>/scripts/agent-context.mjs init` writes a block into the project `AGENTS.md` that any agent reading `AGENTS.md`, Codex included, follows: read `.agent/context.md` first, write the session log and decisions at the end.

Not in Codex: the rule files (they arrive through a Claude Code SessionStart hook; you can print them with `node <plugin-dir>/scripts/build-policy.mjs` and add them to `~/.codex/AGENTS.md` yourself), the subagent guards and the Stop dispatcher. The Codex side has had much less use than the Claude Code side.

```
git clone https://github.com/Idfoxes/keelson
cd keelson
./install-codex.sh
```

The script copies the scripts to `~/.keelson/plugin` so the hooks keep working if you move the clone. Update with `git pull && ./install-codex.sh`. Remove everything with `./install-codex.sh --uninstall` (your data in `~/.agent` stays). `KEELSON_HOME`, `CODEX_HOME` and `KEELSON_SKILLS_DIR` override the locations.

## Portability

All memory is plain files on your machine: the journal, lessons, findings, handoffs, the turn log and the tool ledger in `~/.agent`, and the project records in `.agent/` inside each repository. None of it lives in a provider account. If you lose access to one provider, you start the other agent in the same repository. It reads the same `AGENTS.md` and `.agent/context.md`, the same hooks keep writing to the same `~/.agent`, `recall.mjs` searches the history, and `handoff.mjs show` prints the last handoff note.

## FAQ

**Does it send data anywhere?** No. The hooks and scripts open no network connections and there is no telemetry. Everything is written to `~/.agent` and, if you run `agent-context.mjs init`, to `.agent/` in your repositories. The guards that block a turn add text to the conversation, so that text goes to your model provider like anything else in the session.

**Does it slow Claude Code down?** Barely. A hook is one `node` process of 14 to 23 ms on a quiet machine. The Stop dispatcher takes about 60 ms there, with a longer tail in daily use when the quality gate runs your tests (see [Overhead](#overhead)). A block from the Stop dispatcher costs one extra model turn.

**Can I use only some hooks?** The plugin installs all 16 as a unit. To run fewer, either limit the Stop checks with the environment variable `KEELSON_STOP_CHECKS` (a comma-separated list of script names, for example `quality-gate.mjs,claims-guard.mjs`) in the `env` block of your Claude Code settings, or skip the plugin and register single scripts in your own `settings.json` with a command such as `node /path/to/keelson/plugins/keelson/scripts/destructive-guard.mjs`. Thresholds have variables too: `AGENT_CTX_WARN_TOKENS`, `AGENT_CTX_STOP_TOKENS`, `KEELSON_REVIEW_MIN_LINES`, `KEELSON_GATE_BUDGET_MS`. More in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

**How do I uninstall?** See [Uninstall](#uninstall). Your data in `~/.agent` stays until you delete it.

**How is it different from writing a CLAUDE.md?** A CLAUDE.md is a request the model may or may not follow, and it cannot see what happened. Keelson adds what a text file cannot: hooks that check the result at the end of the turn and refuse a turn that claims tests passed without running them, a record of what every session did and cost, and a weekly loop that turns repeated corrections into lessons and rules with evidence. It also writes and reads a CLAUDE.md-style context for you (`AGENTS.md` and `.agent/context.md`), so the two work together.

## Uninstall

Claude Code:

```
/plugin uninstall keelson@keelson
/plugin marketplace remove keelson
```

Codex: `./install-codex.sh --uninstall`. To delete the collected data as well, remove `~/.agent`. The `.agent/` folders inside your repositories are yours; delete them if you do not want them.

## Status and limits

Beta, 0.1.0. What is rough:

- Hook messages, rule files and the dashboard are in English. Several heuristics (the "done" claim detector, the "I will continue myself" detector, the Haiku router) match English and Russian phrases, with thinner English coverage.
- No benchmark numbers are published yet. The timings above come from one Linux VM and your numbers will differ.
- The behavioral tests live outside this package. CI here checks syntax, manifests, skill frontmatter, that every hook points at a shipped script, and that every guard exits cleanly on a sample payload.
- A handoff that opens the next session by itself works only in the Claude Code desktop app. Elsewhere the agent writes the handoff and asks you to start a new session.
- Logs are not rotated.
- Developed and tested on macOS and Linux. Windows is untested. The dashboard opens with the macOS `open` command.

## Roadmap

Not promises, directions: a log rotation command, a published benchmark of the guards, behavioral tests in this repository, more Codex coverage, better English coverage for the phrase heuristics. Tell us what you need in an [issue](https://github.com/Idfoxes/keelson/issues).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run the checks and add a guard, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security notes are in [SECURITY.md](SECURITY.md), changes in [CHANGELOG.md](CHANGELOG.md).

## License

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
