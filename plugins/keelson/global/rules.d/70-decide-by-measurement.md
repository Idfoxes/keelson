## Decide by measurement

Choose between technologies, libraries, algorithms or constant values by measurement, not opinion.

- Build two variants that differ in one thing. Use a load close to production. Run each at least three times and report the median and the spread.
- Keep the scratch benchmark in `.agent/scratch/`, outside git.
- Cite two or more documentation sources with numbers and links.
- Record the outcome in an ADR (`agent-context.mjs adr "Title"`) with the numbers.
- Never write "faster" or "handles the load" without a number and a source. The gate stops an ADR that does.
