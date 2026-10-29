# Sample weekly report

This is a SAMPLE. The repositories, session ids and every number below are invented to show the structure of the report that `/keelson:weekly-review` writes to `~/.agent/reviews/<date>.md`. Nothing here is a measurement or a promise of results.

The command runs `findings.mjs stats`, `findings.mjs acted`, `learn.mjs suggest`, `context-ledger.mjs --cost` and `lessons.mjs list`, reads last week's report if there is one, and writes the file. It proposes changes and applies none. You read the report and run the commands you agree with.

---

# Weekly review, <date> (SAMPLE)

Period: 7 days (findings that repeat: 14 days). Repositories with activity: `webapp`, `billing-api`, `etl-jobs`.

## Last week's proposals

- Lesson "check the project virtualenv before running pytest" (`etl-jobs`): applied. Findings of class `tests` in `etl-jobs`: 6 last week, 1 this week (`findings.mjs stats`).
- Convention entry for the term `account` (`webapp`): applied. Class `terms` in `webapp`: 5 last week, 2 this week. Better, not gone; the two new ones use `member` in test names.
- Rule against long shell pipelines: not applied by the owner. No change in the data. Dropped from this report.
- Lesson "name the canonical term before adding a UI string" (`webapp`): cannot tell. It was shown 2 times; the data has no signal either way.

## Top cost drivers

Estimated at cache-read prices from `context-ledger.mjs --cost --days 7`: about <total> across <n> sessions (EXAMPLE). By model: opus <amount>, sonnet <amount>, haiku <amount>. Reads and searches on the expensive model: <amount>, about a fifth of the total.

- `a41f09c2`, `webapp`: <amount>, 2,310 calls, average context 128k. 702 of the calls were reads and searches on the expensive model. Cause: long searches ran in the main session instead of a cheap subagent.
- `7c20be11`, `billing-api`: <amount>, 1,180 calls, context above 200k for the last 300 calls. Cause: the session was never handed off or compacted.
- `e5d8a370`, `etl-jobs`: <amount>, 940 calls, 18 identical `git status` calls within four minutes. Cause: a polling loop; the loop warning fired once.

## Repeated finding classes

`findings.mjs stats --days 7`: 118 findings. Classes: contract 41, test-gap 22, terms 15, tests 12, lint 10, claim 9, single-source 5, other 4. Share of findings followed by an edit within 48 hours (`findings.mjs acted`): 64 %.

Three or more in 14 days (`learn.mjs suggest --days 14`):

- `webapp` terms x5: `account`, `user` and `member` for the same concept. Example: `src/ui/Header.tsx:18`.
- `billing-api` contract x4: a response field documented as optional and always returned. Example: `api/invoices.yaml:112`.
- `etl-jobs` tests x6: pytest ran under the system Python without the project dependencies. Example: `tests/test_load.py:1`.
- all repositories, claim x9: "tests pass" in a final answer with no test run in the turn.

## Proposed changes

1. Add the canonical term `account` to `webapp` conventions.
   Evidence: `learn.mjs suggest`, `webapp` terms x5 in 14 days, three files.
   Change: in `.agent/conventions.json` of `webapp`, add under `terms` the entry `"account": ["user", "member"]`.
2. Lesson for the repeated claim without a test run.
   Evidence: `findings.mjs stats`, claim 9 findings in 8 turns, across all repositories.
   Change:
   ```
   node <plugin-dir>/scripts/lessons.mjs add "Run the tests in the same turn before writing that they pass" --when "tests pass; all green; verified" --evidence "9 claim findings in 7 days" --global
   ```
3. Widen the trigger of an existing lesson.
   Evidence: `lessons.mjs list` shows "run the migration test before the whole suite" with trigger "fix the migration"; the prompt "repair the migration" did not match and the correction was repeated once.
   Change:
   ```
   node <plugin-dir>/scripts/lessons.mjs add "Run the migration test before the whole suite" --when "fix the migration; repair the migration" --evidence "repeated correction after the lesson was shown"
   ```
4. Rule for a hard-coded test timeout in `etl-jobs`, shadow mode first.
   Evidence: `etl-jobs` tests x6, four of them a `sleep(` call in a test.
   Change: create `.agent/rules/no-sleep-in-tests.json`:
   ```
   {"id": "no-sleep-in-tests", "pattern": "\\bsleep\\(", "paths": ["tests/**"], "class": "tests", "message": "wait on a condition, not a fixed sleep", "mode": "shadow"}
   ```

## No change

- `billing-api` contract x4: a regular expression cannot catch it. A test that compares the OpenAPI schema with a recorded response would; no proposal until someone owns that test.
- Session `7c20be11` context above 200k: the compaction setting already exists; nothing to add.
- `lint` x10 and `types`: spread over many files and rules, no repeated cause.
- Hooks: nothing in `hook-runs.jsonl` looked broken.

Nothing was applied. Apply the commands above yourself, or ignore them.
