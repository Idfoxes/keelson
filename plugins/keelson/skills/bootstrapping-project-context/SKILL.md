---
name: bootstrapping-project-context
description: "Use when beginning development, maintenance, debugging, or ongoing work in a Git repository that has no valid project-local agent context yet (.agent/project.yaml and .agent/context.md)."
---

# Bootstrapping Project Context

**REQUIRED SUB-SKILL:** Use `project-memory`.

## Core Rule

For a repository that qualifies for bootstrap:

INSPECT
→ BOOTSTRAP PROJECT CONTEXT
→ CONTINUE ORIGINAL TASK
→ VERIFY
→ UPDATE CURRENT MEMORY IF NEEDED

Do not perform the substantive code change first and add project memory afterward.

If the root cause appears obvious during inspection, that does NOT permit an early fix.
Do not edit production/source/test files until the initial agent layer has been created.

Red flags — stop before editing code:
- "The bug is obvious, I'll fix it first."
- "Bootstrap can wait until after this one-line change."
- "I already understand enough of the repo."
- "Creating memory first is unnecessary overhead."

All of these still require:
INSPECT → BOOTSTRAP → ORIGINAL TASK.

Bootstrap is part of task initialization.

## Contract

- **Needs**: a git repository whose `.agent/project.yaml` or `.agent/context.md` is missing or invalid, and a task implying ongoing ownership
- **Produces**: the agent layer from `agent-context.mjs init` with `.agent/context.md` filled as a pre-task snapshot
- **After**: —
- **Before**: project-memory
- **Done when**: `agent-context.mjs check` passes and nothing anticipated by the pending task is recorded as current state

## When to Bootstrap

Use when:

- current workspace is a Git repository;
- `.agent/project.yaml` or `.agent/context.md` is missing or clearly invalid;
- the task involves development, debugging, maintenance, implementation,
  architecture, or likely ongoing ownership of the project.

Do not modify a repository merely because it was opened.

For read-only explanation, code reading, review, or one-off inspection:
inspect without creating `.agent/**` unless explicitly requested.

## Step 1 — Inspect Minimally

Before writing project memory, inspect only enough evidence to understand the repository:

- existing `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING*`, README;
- `git status --short --branch`;
- top-level tree;
- build/dependency manifests;
- test configuration;
- obvious runtime/entrypoint files;
- CI/CD files if present;
- deployment/runtime files if present.

Use recent git history only when it materially affects current understanding.

Do not scan the whole repository by default.

## Step 2 — Separate Facts From Inference

Every project fact placed in durable memory must be one of:

- confirmed from repository artifacts;
- observed from a command actually run in this session;
- `NEEDS_VERIFICATION`.

Never convert a convenience inference into a durable project fact.

Examples:

A local `python --version` result is an observed local runtime, not necessarily
the project's required Python version.

A tiny repository with one source file does not prove a durable architectural
decision to remain single-module.

A deployment-looking file does not prove production exists.

## Step 3 — Do Not Invent Decisions

`.agent/decisions.md` contains only decisions that are actually evidenced by:

- existing repository documentation;
- git history with clear intent;
- current user instruction;
- a decision explicitly made during the current task.

If no durable decisions are known, write that none are recorded yet.

Do not manufacture design policy, thresholds, future refactoring rules, or
architectural preferences merely to make the file non-empty.

## Bootstrap Snapshot Boundary

The initial agent layer is a PRE-TASK snapshot.

At initial bootstrap time, describe only the repository state that exists before
the substantive user-requested change.

Do not write:

- that the current bug is already fixed;
- capabilities that will exist only after the requested implementation;
- architecture or data flow that depends on the planned fix;
- successful test results that have not yet been observed;
- completed deployment/build/runtime claims that belong to the future state.

If the user's requested change is still pending, record it as active work or an
active issue.

After implementation and fresh verification, update only the memory files whose
durable truth actually changed.

Example:

Before fix:
`Active issue: make_slug currently returns the input unchanged.`

After verified fix:
`Current capability: make_slug("Hello World") returns "hello-world".`

Do not collapse these two temporal states into one bootstrap write.

## Step 4 — Create Standard Agent Layer

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/agent-context.mjs init`. It creates, without overwriting anything:

- `AGENTS.md` with the agent-context block (any agent reads it), `CLAUDE.md` importing it;
- `.agent/context.md` skeleton, `.agent/log.md`, `.agent/map.md` from `git ls-files`;
- `.agent/decisions/` unless `docs/adr` or similar exists, `.agent/incidents/`;
- `.gitattributes` union merge for the log, `.gitignore` re-includes if `.agent/` was ignored.

Then replace every NEEDS_VERIFICATION in `.agent/context.md` with evidenced facts. `agent-context.mjs check` must pass before the layer is called done. Existing `project.yaml`, `architecture.md`, runbooks stay; create them only when the repository has facts for them.

## Step 5 — Memory Shape

`AGENTS.md`
= concise routing and operating rules.

`.agent/project.yaml`
= concise machine-readable CURRENT facts.

`.agent/context.md`
= concise human-readable CURRENT snapshot.

During the initial bootstrap, record the state that exists NOW.

Do not write the anticipated result of the original task as though it has
already happened. If a bug is still unresolved at bootstrap time, record it as
an active issue. After the original task is verified, update the snapshot to
the new confirmed state.

`.agent/architecture.md`
= repository-supported structure, boundaries, runtime/data-flow facts.

During initial bootstrap, architecture describes the repository as it currently
exists. Do not use architecture.md as a design specification for the pending
user-requested change.

A normal behavior-changing bugfix usually updates `context.md`, not
`architecture.md`, unless the verified change actually alters durable
architecture, boundaries, runtime, or data flow.

`.agent/decisions.md`
= only real durable decisions.

`.agent/memory/index.md`
= routing index for historical/root-cause/research memory.

Empty-history repositories must not fabricate incidents or history.


## Startup Budget

`AGENTS.md`, `.agent/project.yaml` and `.agent/context.md` are read at the start
of every session in this repository, so their size is a recurring cost paid
forever. Hold them to roughly 2 KB, 3 KB and 3 KB.

Every other file in the layer is cold: read only when the task needs it, and
allowed to be longer.

When a startup file exceeds its budget, move detail into a cold file or replace
it with a pointer. Never trim by dropping facts.

### Pointer, not copy

An enumeration longer than about ten items - environment variables, endpoints,
table columns, route prefixes, file lists - is recorded as a count plus its
source location, never transcribed. For a small invented service:

```yaml
config:
  env_vars: 23 variables, defined in app/settings.py:12-60
  feature_flags: 4 variables, app/flags.py:5-18
```

The source outranks the copy and cannot go stale, while a transcribed list is
wrong the moment someone adds a variable. Transcribe only when the user asks for
the full list, or when no single source location exists.

## Step 6 — Operational Truth

Test runbook:
record test commands evidenced by repository configuration/documentation.

Distinguish command discovery from execution evidence.

Allowed before running:
`Test command: python -m pytest — evidenced by README.`

Allowed only after a successful fresh run:
`Verified in this session: python -m pytest — PASS.`

Never write "confirmed working", "verified", "passes", or equivalent unless that
specific command has already completed successfully in the current state.

Deploy runbook:
record only evidenced deployment procedure.
Otherwise use `NEEDS_VERIFICATION`.

Production runbook:
record only known production metadata and safe verification instructions.
If no production is evidenced, say so explicitly.

Do not infer production hosts, services, deployment commands, credentials,
or environment values.

## Step 7 — Protect Secrets and Local State

Never read secrets merely to populate project context.

Never store:

- API keys;
- tokens;
- passwords;
- DSNs;
- private keys;
- session files;
- cookies;
- raw `.env` contents.

Environment variable names may be recorded when discovered from safe artifacts.

Generated local artifacts are not project memory.

Before completion, inspect `git status` for artifacts created by commands run
during the task, including caches, coverage output, build directories, logs,
temporary files, and interpreter metadata.

If such artifacts are disposable and untracked, remove them safely.
If they are expected to recur and the repository lacks an appropriate ignore
rule, add the narrowest suitable `.gitignore` entry when appropriate.

Do not leave task-generated cache/build artifacts untracked at completion.
Do not remove pre-existing user files merely because they look generated.
Do not perform unrelated ignore-file cleanup.

## Step 8 — Continue Original Task

Only after the initial agent layer exists:

- perform skill selection again for the original task;
- invoke every relevant required process/domain skill;
- continue the user's original development/debugging task;
- implement only after those required workflows permit implementation;
- verify behavior;
- update `.agent/context.md` from the verified final state only if meaningful
  durable state changed.

Bootstrap does not replace systematic debugging, TDD, brainstorming,
verification-before-completion, or another applicable workflow skill.

Bootstrap must not become the user's final deliverable.

## Source-of-Truth Rule

Project files and current user instructions outrank generated memory.

If project memory conflicts with repository evidence, reconcile the memory.

Do not copy project-specific facts from another repository.

## Permissions

Bootstrap does not grant permission to:

- commit;
- push;
- deploy;
- connect to production;
- mutate production;
- perform destructive commands.

Follow current user instructions and repository-local policy.

## Completion Gate

Before declaring bootstrap complete:

- `project-memory` was used;
- `agent-context.mjs check` passes;
- any YAML written parses with a YAML parser, not visual inspection alone;
- machine-readable fields have the intended types and nesting;
- no fabricated architectural decisions were added;
- runtime observations are not mislabeled as project requirements;
- unknown operational facts are `NEEDS_VERIFICATION`;
- startup context remains concise;
- no secrets were written;
- no unrelated project files were changed;
- generated local artifacts are handled appropriately;
- the startup files are within budget;
- no enumeration over ten items was transcribed where a source location exists;
- the report says WHERE the layer was written. If the session ran in a git
  worktree or on a branch, name it and give the command that brings the files
  into the checkout the user actually works in. Files the user cannot see in
  their own working tree are not delivered;
- the original user task is verified separately from bootstrap.

This skill should stop triggering once valid `.agent/project.yaml` and
`.agent/context.md` exist.