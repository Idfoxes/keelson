---
name: project-memory
description: "Use when working in a repository that keeps durable project context, cross-session memory, incident history, decisions, or agent state across Claude, Codex, and later sessions."
---

# Project Memory

## Core Principle

Project memory is durable project knowledge, not a transcript.

Keep startup context small. Load only current truth by default and retrieve historical detail only when the task requires it.

## Contract

- **Needs**: a repository carrying a durable context layer — `AGENTS.md`, `.agent/project.yaml`, `.agent/context.md`
- **Produces**: the changed durable fact written into one correct layer, historical detail moved to `.agent/memory/**`
- **After**: —
- **Before**: —
- **Done when**: current context still fits a startup read and no routine successful execution was recorded

## Memory Layers

Prefer this order when a repository supports it:

1. `AGENTS.md` — agent operating rules.
2. `.agent/project.yaml` — machine-readable current operational truth.
3. `.agent/context.md` — concise human-readable current project state.
4. Actual repository files and git state — implementation truth.
5. `.agent/architecture.md`, `.agent/decisions.md`, runbooks — supporting context.
6. `.agent/memory/index.md` — routing index for historical/root-cause/research memory.
7. `.agent/memory/**` — cold durable history loaded only when relevant.

Current user instructions and actual repository state outrank stored memory.

## Startup

For an ordinary task:

- read the repository's normal startup instructions;
- read only current project context required by those instructions;
- inspect `git status`;
- inspect actual files relevant to the task.

Do NOT automatically load:

- all `.agent/memory/**`;
- old incidents;
- full deployment history;
- all decisions;
- all runbooks;
- full git history;
- historical logs.

## Historical Recall

Open `.agent/memory/index.md` when:

- the user asks why something was designed this way;
- a previously solved incident may have recurred;
- prior root-cause evidence matters;
- old deployment/migration history matters;
- prior research results matter;
- current context explicitly routes the task there.

From the index, open only the relevant memory file.

Do not read the entire memory tree unless the task genuinely requires a complete audit.

## Writing Durable Memory

Update durable memory only when a meaningful persistent fact changed, such as:

- current production state;
- architecture;
- durable decision;
- confirmed root cause;
- important incident resolution;
- meaningful research result;
- active issue or priority.

Do not store:

- full conversations;
- raw logs;
- temporary commands;
- step-by-step debugging chronology;
- speculation;
- duplicate summaries;
- secrets.

## Hot vs Cold Memory

`.agent/context.md` is a CURRENT SNAPSHOT.

It should contain:

- current capabilities;
- current production state;
- active issues;
- current research status;
- critical constraints;
- routing pointers.

It should not grow into a historical journal.

Move durable historical detail into thematic files under `.agent/memory/**`.

## Source-of-Truth Discipline

When current memory files disagree:

1. inspect actual repository state;
2. prefer the freshest verified evidence;
3. reconcile machine-readable and human-readable current truth;
4. move superseded state to history if it remains useful.

Never silently choose an older fact because it appears in more files.

## Token Discipline

Before opening another memory file, ask:

"Will this file materially change the current task?"

If no, do not load it.

Prefer one relevant historical memory file over reading many partially related files.

## Completion

Before finishing meaningful work:

- determine whether durable project state changed;
- update the correct memory layer if warranted;
- keep current context concise;
- preserve detailed history in cold memory;
- verify no secret values were written.

Do not create a memory update merely to record routine successful execution.
