---
name: session-diary
description: "Use when a piece of work is ending and what the user corrected, chose, or clarified during it should outlive the chat: closing a task, turning a said-once correction into a standing rule, recording an interpretation, deviation or tradeoff made mid-task, or writing a decision into the project's `## Decided` section."
---

# Session Diary

## Core Principle

A correction said once in a chat is not knowledge until it is written down.

Keep a diary while the work happens, show it verbatim when the work ends, and
let the human decide what becomes a rule. Nothing is promoted without that
decision, and no engine runs this: you run it, by hand, in the same session.
The diary is cheap because it is only ever written; the rules are cheap because
only they are read back.

## Contract
- **Needs**: a task with real back-and-forth, a repository open, and a project
  file carrying a `## Decided` section, or room to add one.
- **Produces**: `.agent/diary/<YYMMDD>-<label>.md` written during the task, and
  zero or more rule lines appended to `## Decided` at the end of it.
- **After**: the substantive work is done and verified.
- **Before**: the final report to the user, in the session that did the work.
- **Done when**: entries under the first three headings were shown verbatim,
  the addition question was asked, every kept line was conflict-checked, and
  every written line carries its dedup marker.

## When No Diary Is Kept

Do not open a diary for a one-off read: a question answered, code explained, a
review with no edits, a single lookup. `bootstrapping-project-context` already
draws this line for `.agent/**` as a whole; follow it. A repository that does
not qualify for `.agent/**` does not get `.agent/diary/` either.

## Keep the Diary While Working

Append to the diary as the task runs. Do not reconstruct it at the end: by
then the interpretations have collapsed into "it worked" and the deviations are
invisible. Write to `.agent/diary/<YYMMDD>-<label>.md`, where `<YYMMDD>` is
today's date as year, month, day in two digits each, and `<label>` is a short
slug of the task (`retry-backoff`).

Exactly four H2 headings, in this order, and no others:

- `## Interpretations`: what you understood the user to mean, in your own
  words, where the instruction allowed more than one reading.
- `## Deviations`: where you did something other than what was asked, and why.
- `## Tradeoffs`: where you chose one of two options, and what you paid.
- `## Open questions`: what stayed unclear.

One entry is one bullet:

    - <ISO-8601 UTC timestamp> - <outcome in one phrase>; <two or three sentences of context>

The file is write-only. Do not read it back while working, do not summarise it
mid-task, do not use it as a place to think. It exists so that the closing
ritual has something verbatim to show.

## What Is Not a Diary Entry

Four things belong nowhere near the diary:

- A recap of what you did. The tool calls are already visible. "Implemented the
  retry loop" is not an interpretation.
- Successful execution with no deviation. Most tasks end with an empty diary,
  and that is the normal outcome, not a lapse of attention.
- Your own conclusion that the human never confirmed. An inference you made
  alone belongs under `## Open questions` at best, and never becomes a rule.
- Anything stale by next week: the current branch, today's flaky test, a number
  from one run. A rule outlives the task or it is noise.

## The Closing Ritual

When the substantive work is finished, before the final report:

1. Show every entry under `## Interpretations`, `## Deviations`, and
   `## Tradeoffs` **verbatim**: no paraphrase, no merging, no sorting by what
   you find interesting, nothing dropped for looking small. Your judgement
   about what matters is exactly what this step removes.
2. Let the user pick what to keep. Keeping nothing is a valid answer.
3. Ask, always: "Anything to add for the future?" Ask it even when the diary is
   empty and even when the user kept nothing. Do not answer it for them, do not
   read "nothing" into silence, do not skip it because the task was small. A
   free-text answer becomes a candidate like any other.

Zero surfaced entries is not permission to skip step 3.

## Open Questions Are Never Promoted

`## Open questions` entries are research items, not knowledge. They are not
shown in the ritual, not offered for keeping, and never written as rules.
Restate one in the final report if it still matters, or leave it in the file:
an unresolved question written as a rule is worse than no rule.

## Check for Conflict Before Writing

For every line the user kept, compare it against the project's `## Decided`
section and any other convention file the repository carries (`AGENTS.md`,
`.agent/conventions.json`).

If the new line contradicts something there, stop. Show the contradicting
sentence verbatim, name the file it came from, and ask which one holds. Do not
overwrite, do not append the new line beside the old one as if both were true,
and do not resolve it by recency. The user then revises the new line, drops it,
or supersedes the old one explicitly. Only conflict-clear lines get written.

## Write the Rule

Append each kept line to `## Decided` in the project file that carries that
section, creating the section if the project has none yet:

    - <text> (learned YYYY-MM-DD) <!-- id:<16 hex characters> -->

The marker is the deduplication key: the first 16 characters of the SHA-256 of
the rule text:

    printf '%s' '<text>' | sha256sum | cut -c1-16

Before appending, check whether that id is already in the file. If it is, the
rule was learned in an earlier ritual; skip it silently, so that running the
ritual twice over one piece of work cannot produce two copies of one rule.

## This Skill Does Not Learn

Nothing from the ritual is written into this file, or any other `SKILL.md`.
Rules live in `## Decided`; skills carry method. The split is not cosmetic:
installed skills are replaced wholesale on every plugin update, so a rule edited
into a skill body is destroyed by the next update, and a local edit that
survives it turns that update into a conflict.

There is no automatic promotion. No entry becomes a rule because it looked
important, repeated, or came out of a large task. A human names each one.

## What This Costs

The diary is written during the task and is never read at session start. What a
future session loads is `## Decided`: a few lines inside a project file it was
going to read anyway. Diaries stay on disk and cost nothing until opened.

If that inverts and diaries start being loaded at startup, the design is gone:
startup context then grows with every task ever run, which is the outcome
`project-memory` exists to prevent.

## Completion

Before declaring the task finished:

- the diary was written during the work, not assembled at the end;
- entries under the three promotable headings were shown verbatim;
- the "anything to add for the future" question was asked, empty diary included;
- no `## Open questions` entry was offered for promotion;
- every kept line was checked against `## Decided` and the other convention files;
- every conflict was surfaced with the contradicting text, not settled alone;
- each written line carries `(learned YYYY-MM-DD)` and its id marker, and no id
  already present in the file was appended a second time;
- no skill file was edited, and no secret, token, or host value entered a rule.
