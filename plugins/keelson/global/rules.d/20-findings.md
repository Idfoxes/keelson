## Findings log

Log every review remark as one line, whether it comes from a reviewer subagent or a colleague:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/findings.mjs add --class <class> --severity high|medium|low --source review|colleague --file <file:line> --evidence "<what is wrong>"`

List the classes with `findings.mjs classes`. Pick the class by cause: inconsistent names are `terms`, declared behaviour that differs from actual behaviour is `contract`, one value kept in two places is `single-source`. A class that repeats three times becomes a rule or a test.
