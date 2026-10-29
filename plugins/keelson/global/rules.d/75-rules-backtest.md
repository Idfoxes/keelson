## Rules from repeated findings

When a finding class repeats three times, turn it into a rule file `.agent/rules/<id>.json` with `pattern` (a regex run on each added line), `paths`, `class`, `message` and `mode`.

- Test the pattern first on past code: it must catch the earlier findings of that class and stay silent on the current code.
- Start with `"mode": "shadow"`. The gate then only logs hits and blocks nothing.
- After a week, check how many hits were later fixed. Promote the rule to blocking if most were. Otherwise tighten or disable it.
- Run `findings.mjs stats` to see which classes repeat.
