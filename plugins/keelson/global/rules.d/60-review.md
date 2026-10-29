## Review without being asked

A task that changed more than 50 lines of code ends with a review. Before saying "done", call the `diff-reviewer` subagent on the task diff, with the acceptance criteria and no conversation history.

- Fix every high and medium remark, then re-check.
- `review-guard.mjs` blocks the first "done" that follows more than 50 unreviewed changed lines.

Before coding, list each promised behaviour (a field, a status, an error, a metric, a side effect) on its own line with the test that pins it. Write that test first and watch it fail. Give the list to the reviewer, who marks each item done, missing, partial, contradicted or extra.
