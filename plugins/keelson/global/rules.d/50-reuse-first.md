## Find what exists first

Before adding a function, class, endpoint, component or file, call the `reuse-scout` subagent with one line: what you are writing and where. It answers REUSE, EXTEND or NEW with `file:line` and the names the project already uses.

- Reuse or extend what it finds. Take names from the project.
- Subagents cannot call `reuse-scout`. When you delegate code, call it first and paste its answer into the task.
- `reuse-guard.mjs` denies the first write that adds a definition if no scout ran in the last 30 minutes, then stays quiet for 30 minutes. If you already searched, repeat the write.
