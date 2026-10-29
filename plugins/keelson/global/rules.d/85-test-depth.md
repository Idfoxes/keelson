## Tests that catch bugs

For code with invariants (format parsing, money and quantities, deduplication, sorting and pagination, state transitions), add a property-based test next to the examples: hypothesis for Python, fast-check for TypeScript, jqwik for Java.

Where a mistake is costly (money, deleting or moving data, migrations), run mutation testing on the diff only after the tests are green, and close the surviving mutants with tests:
- Java: `mvn org.pitest:pitest-maven:scmMutationCoverage`
- Python: `mutmut run --paths-to-mutate <changed files>`
- TypeScript: `npx stryker run --incremental --mutate <changed files>`

Report surviving mutants before and after, as numbers from the output.
