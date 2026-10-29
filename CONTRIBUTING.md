# Contributing

Thank you for looking. Keelson is small on purpose: plain Node scripts, no dependencies, no build step. A change that keeps it that way is easy to review.

## Before you start

Open an issue first for anything bigger than a fix, so the direction is agreed before you write code. A bug report with the hook payload that caused it is the most useful contribution.

## Layout

```
plugins/keelson/scripts/          one .mjs file per hook, or per command you run by hand
plugins/keelson/scripts/lib/      helpers shared by the scripts
plugins/keelson/hooks/hooks.json  the hook registrations
plugins/keelson/skills/           SKILL.md files
plugins/keelson/agents/           subagent definitions
plugins/keelson/commands/         slash commands
plugins/keelson/global/rules.d/   rule files injected at session start
docs/                             architecture, troubleshooting, a sample report
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the hooks fit together.

## Run the checks locally

The CI runs two jobs on Node 18, 20 and 22. Run the same commands from the repository root.

Syntax, manifests and skill frontmatter:

```
find . -name '*.mjs' -not -path './.git/*' -print0 | xargs -0 -n1 node --check
find . -name '*.sh' -not -path './.git/*' -print0 | xargs -0 -n1 bash -n
find . -name '*.json' -not -path './.git/*' -print0 | xargs -0 -n1 node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))'
```

The `hooks` job checks that every command in `plugins/keelson/hooks/hooks.json` points at a script that exists, then feeds each guard a sample payload in a temporary `HOME` and a temporary git repository. A guard must exit 0 and print nothing or valid JSON. The destructive-command guard must ask before `git push --force`. The job is the `hooks` section of `.github/workflows/ci.yml`: copy its smoke script to a file and run `bash smoke.sh plugins/keelson/scripts` to reproduce it.

## Add or change a guard

1. Put the script in `plugins/keelson/scripts/`. Read the JSON payload from stdin. Write the verdict to stdout or, for a Stop check, to stderr with exit code 2.
2. A guard must never break a session. On an unexpected error it exits 0 and prints nothing.
3. Do not open network connections. Keelson stays local.
4. Mask secrets with `scripts/lib/redact.mjs` before you write a prompt, a command or a reason to a file.
5. Register the hook in `plugins/keelson/hooks/hooks.json`, then add the script to the smoke script in the CI so a crash on a sample payload fails the build.
6. Document the hook in the README table and in `CHANGELOG.md`.

## Style

- Node 18 or newer, ES modules, standard library only.
- Code carries no comments. Names say what a value holds and what a function does. Something that needs a comment becomes a named function. A fact that does not follow from the code goes into the README or a document.
- Messages shown to the user are English, short, and say what to do next.
- Rule files are short: one rule, the reason, and what counts as done.
- Commit messages are plain English, one line, in the imperative: "Add a timeout to the push-first check".

## Pull requests

One change per pull request. Say what changed, why, and what you ran. If a check was not run, say so. The pull request template has the list.

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing you agree that your work is released under the [Apache License 2.0](LICENSE).
