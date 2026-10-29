---
description: Review the last week of Keelson data and write a report with proposed rule and lesson changes. Proposes only, never edits rules or settings.
allowed-tools: Bash(node:*), Read, Write
---

Run the weekly review for Keelson. You propose changes. You never apply them: do not edit rule files, `.agent/` files, settings, `CLAUDE.md` or `AGENTS.md`, and do not run `lessons.mjs add` yourself. The only file you write is the report.

Use only the commands below. Run them one by one and read the whole output of each.

1. Today's date: `node -e 'console.log(new Date().toISOString().slice(0,10))'`. Call it TODAY.
2. Findings by class: `node ${CLAUDE_PLUGIN_ROOT}/scripts/findings.mjs stats --days 7`
3. What happened to findings after they were reported: `node ${CLAUDE_PLUGIN_ROOT}/scripts/findings.mjs acted --days 14`
4. Repeated finding classes that are candidates for a rule: `node ${CLAUDE_PLUGIN_ROOT}/scripts/learn.mjs suggest --days 14`
5. Cost of resending context: `node ${CLAUDE_PLUGIN_ROOT}/scripts/context-ledger.mjs --cost --days 7`
6. The most expensive session in step 5, if there is one: `node ${CLAUDE_PLUGIN_ROOT}/scripts/context-ledger.mjs --report <session id>`
7. Existing lessons: `node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list`
8. Last week's report: `node -e 'const d=require("os").homedir()+"/.agent/reviews";console.log(require("fs").existsSync(d)?require("fs").readdirSync(d).sort().join("\n"):"none")'`. If a file other than today's exists, Read the newest one at `~/.agent/reviews/<date>.md`.

If a command prints that there is no data, say so in the report and go on. Do not invent numbers. Every number in the report comes from the output above, and each claim names the command it came from.

Write the report to `~/.agent/reviews/TODAY.md`. Create the folder first with `node -e 'require("fs").mkdirSync(require("os").homedir()+"/.agent/reviews",{recursive:true})'`. Use these sections, in this order, and no others:

1. `# Weekly review, TODAY`, then one line with the period (7 days, or 14 for findings that repeat) and the repositories that had activity.
2. `## Last week's proposals`. Only if a previous report exists. For each proposal in it, say what happened, using the new data: applied (the rule, lesson or convention now exists and the count of the matching class fell), applied but not working (the class kept repeating), not applied, or cannot tell. Give the counts before and after.
3. `## Top cost drivers`. Up to three sessions or patterns from steps 5 and 6, each with the dollar figure, the call count, the average context and one concrete cause (for example: reads and searches on the expensive model, a loop of identical calls, a context above 200k that was never handed off). The ledger price is an estimate at cache-read prices; say so once.
4. `## Repeated finding classes`. Classes from steps 2 to 4 that repeated three times or more, with the count and one `file:line` example each. Say which ones `learn.mjs` marks as already covered by a rule that is not catching them.
5. `## Proposed changes`. At most five, ordered by evidence. Each one has: a one-line title, an `Evidence:` line quoting the data (count, command, example), and `Change:` with a ready command or text. Use these forms:
   - A lesson, for a correction that repeats: `node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs add "<what to do next time>" --when "<words that show up in the request>" --evidence "<what the user said or the finding>"`, with `--global` if it holds for every repository. Check step 7 first: if a matching lesson exists, propose widening its trigger instead.
   - A rule, for a class with a pattern a regular expression can catch: the JSON for `.agent/rules/<id>.json` with `id`, `pattern`, `paths`, `class`, `message` and `"mode": "shadow"`. Rules always start in shadow mode, which only logs matches.
   - A convention or test, for classes a regular expression cannot catch (a contract mismatch, one number in two places): one sentence naming the file to change.
6. `## No change`. Classes, hooks or costs you looked at and recommend leaving alone, with the reason in one line each. Include anything that is below the threshold of three.

Rules for the report:
- A proposal without an evidence line is dropped.
- Keep the whole report under 120 lines.
- Do not copy prompts, secrets or long output from the logs into the report. Quote at most one line per example.
- End with one line: `Nothing was applied. Apply the commands above yourself, or ignore them.`

After writing the file, print its path and the list of proposal titles. Nothing else.
