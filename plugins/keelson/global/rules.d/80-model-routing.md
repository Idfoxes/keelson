## Model routing

Never switch the main session's model mid-task: it resets the cache and the next turn pays for the whole context again. Choose a model when a fresh context starts.

- Every `general-purpose` subagent gets an explicit `model`. Without it, it runs on the session's expensive model, and `model-route.mjs` denies the call.
- Search, reading logs, cross-checking, counting, formatting: `haiku`.
- Implementing a ready spec with tests, and research: `sonnet`.
- Review, architecture, root cause of an unknown failure: `opus`.
- A brief names the goal, the branch, the files, the acceptance check and the boundaries.
- Never accept a worker's report on trust. Rerun its check and compare the branch and `git log`.
- Continue a worker that stopped early in the same thread (SendMessage): its context is built.
