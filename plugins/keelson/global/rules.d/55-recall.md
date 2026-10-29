## Memory of past sessions

Before a task that resembles an earlier one (same service, same error, "we did this before"), run:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/recall.mjs "<topic in 3-6 words>"`

It searches local prompt history, handoffs, review findings, lessons and ADRs of the current repository. It answers in up to 8 lines with date and source, and sends nothing outside the machine. Use the result before you start from scratch.
