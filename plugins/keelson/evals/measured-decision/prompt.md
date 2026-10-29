---
max_turns: 30
tags: [measure]
---

The export in app/export.py builds its string by concatenation in a loop, and responses can reach 200 thousand rows. Decide whether to keep it or switch to building a list and joining it, and write the decision to docs/adr/0001-csv-export.md.
