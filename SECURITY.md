# Security

## What stays on your machine

Everything. Keelson has no server, no account and no telemetry. Its scripts write plain files under `~/.agent` and, if you ask for it, under `.agent/` in your repositories.

No script in the package opens a network connection or runs `git fetch`, `pull` or `push`. The `claude` and `codex` CLIs talk to their own services like any other session, and the commands a trusted repository lists under `turn_checks` do whatever that repository says (see below).

Secrets are masked before the prompt journal, the turn log, findings and denial reasons are written (see the privacy section of the README for what is and is not covered). The masking is pattern based and cannot be a guarantee.

## Hooks run local commands

A plugin hook is a command that runs on your machine with your permissions. Keelson registers sixteen of them in `plugins/keelson/hooks/hooks.json`, and every one is `node "${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs"`. Read that file and the scripts before you install, and read the diff before you update.

The quality gate runs the commands a repository lists under `turn_checks` in `.agent/project.yaml`, its tests, and the linters from its `.venv` and `node_modules` only for repositories you trusted with `node scripts/quality-gate.mjs trust <repo>`. In any other repository it runs its built-in checks (`node --check`, `bash -n`, stray files) and linters found on your PATH. What a trusted repository's commands do, including network access, is up to that repository.

Guards fail open: if a hook script crashes or cannot read its input, it exits without a decision and the tool call goes on, so a guard is a safety net and not a security boundary.

The permission-denied hook records each refusal and does not retry it. Set `KEELSON_AUTO_RETRY=1` to let it ask Claude Code to retry a refused call, at most three times in ten minutes per session. Leave it unset if you want every refusal to stay a refusal.

## Pin a version

Install from a tag, not from the moving default branch:

```
git clone --branch v0.1.0 https://github.com/Idfoxes/keelson
/plugin marketplace add ./keelson
/plugin install keelson@keelson
```

## Reporting a problem

Open an issue at https://github.com/Idfoxes/keelson/issues. For a security problem, open an issue that says only that you have one and which file it concerns, without exploit details, and ask for a way to send them. Do not paste logs from `~/.agent` into an issue before you have read them: they contain your prompts.
