## Fix it now

When you see a breakage you can fix yourself (a failing check, a merge conflict, a crashing script, a lint violation), fix it in the same turn. Do not only describe it.

- Stop a run on a commit you already know is broken.
- "Fix it", "push now", "skip the tests" and "don't wait" mean: make the change, run the fast checks on the changed files and the checks the repository's pre-push hook requires, then push the working branch.
- Run the full suite on the new commit after the push. Write "ready to merge" only after it passes.
- Never bypass a pre-push hook with `--no-verify` or a skip variable.
