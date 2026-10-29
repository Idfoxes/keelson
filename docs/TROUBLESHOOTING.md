# Troubleshooting

## A hook does not fire

1. Start a new Claude Code session after installing. Hooks load at session start.
2. Check that the plugin is enabled with `/plugin`, and look at the active hooks with `/hooks`.
3. Check the Node version: `node --version` must print 18 or newer, and the `node` that Claude Code finds on its PATH is the one that runs the hooks.
4. Run a script by hand with a sample payload. This shows a crash that Claude Code would hide:

   ```
   echo '{"session_id":"test0001","cwd":"'"$PWD"'","hook_event_name":"UserPromptSubmit","prompt":"hello"}' | node <plugin-dir>/scripts/lessons.mjs; echo "exit $?"
   ```

   A healthy guard exits 0 and prints nothing or one JSON object. A guard never crashes your session on purpose: on an unexpected error it exits 0 silently.
5. Look at `~/.agent/hook-runs.jsonl`. The guards that log (the Stop dispatcher and the checks inside it, among others) write one row per run. No row after a turn means the hook was not started.
6. Start Claude Code with `claude --debug` and read the hook lines.

Some guards are silent by design: `journal.mjs`, `context-guard.mjs` below 120k tokens, `lessons.mjs` with no matching lesson. Silence is not a failure.

## A hook blocks a turn and I disagree

The block text says which check stopped the turn. Fix the cause, or answer the objection with evidence in the same turn. If a check keeps blocking something that is correct, open an issue with the reason line and the `hook-runs.jsonl` row.

## Disable one hook, or some of them

The plugin installs all 16 hook entries as a unit, and an update overwrites edits made inside the plugin folder. Your options, from least to most work:

- **Fewer Stop checks.** Set `KEELSON_STOP_CHECKS` to a comma-separated list of the checks you want, for example `quality-gate.mjs,claims-guard.mjs`. Put it in the `env` block of `~/.claude/settings.json`:

  ```
  { "env": { "KEELSON_STOP_CHECKS": "quality-gate.mjs,claims-guard.mjs" } }
  ```

- **Higher thresholds.** `AGENT_CTX_WARN_TOKENS` (default 120000), `AGENT_CTX_STOP_TOKENS` (default 260000), `KEELSON_REVIEW_MIN_LINES` (default 50) and `KEELSON_GATE_BUDGET_MS` (default 60000) go in the same `env` block.
- **Only the hooks you want.** Do not install the plugin. Clone the repository and register single scripts in your own `settings.json` hooks, for example a PreToolUse hook on `Bash` with the command `node /path/to/keelson/plugins/keelson/scripts/destructive-guard.mjs`. The scripts need only the `scripts/lib` folder next to them.
- **Everything off.** `/plugin disable keelson@keelson`, or uninstall (see the README). Your data in `~/.agent` stays.

## The Stop dispatcher feels slow

The median is tens to a few hundred milliseconds. A long tail comes from the quality gate running the affected tests of a trusted repository. Check:

```
node -e 'const rows=require("fs").readFileSync(require("os").homedir()+"/.agent/hook-runs.jsonl","utf8").trim().split("\n").map(l=>JSON.parse(l)).filter(r=>r.hook==="stop-dispatch").slice(-20);console.log(rows.map(r=>r.ms+" ms "+r.outcome).join("\n"))'
```

Lower `KEELSON_GATE_BUDGET_MS`, or remove the slow command from `turn_checks` in the repository's `.agent/project.yaml`.

## The quality gate does not run my tests

The gate runs the `turn_checks` commands of a repository only after you trust it:

```
node <plugin-dir>/scripts/quality-gate.mjs trust <path-to-repo>
```

The trust list is `~/.agent/trusted-repos.txt`. Until then it runs only the built-in checks and linters found on your PATH.

## Where the logs are

| What | Where |
|---|---|
| Every guard run, with its outcome and timing | `~/.agent/hook-runs.jsonl` |
| Permission denials | `~/.agent/denials.jsonl` |
| Prompts | `~/.agent/journal/YYYY-MM.jsonl` |
| Turns | `~/.agent/turns.jsonl` |
| Tool calls | `~/.agent/context-ledger/<session>.jsonl` |
| Findings | `~/.agent/findings.jsonl` |
| Lessons | `~/.agent/lessons.jsonl` |
| Weekly reports | `~/.agent/reviews/` |

The files are JSON lines. Nothing rotates them in 0.1.0. To free space, delete or truncate old files; the scripts recreate what they need. Do not paste these files into a public issue before you have read them: they contain your prompts.

## The dashboard shows empty sections

Some sections read data that this package does not write, and show an empty state. The page still opens. Run it with `--no-open` on Linux, where there is no macOS `open` command.

## Codex hooks do not run

Codex asks you to trust new hooks. Approve them in Codex. Then check that `~/.codex/hooks.json` has the entries (`./install-codex.sh` writes them) and that `~/.keelson/plugin/scripts` exists. `codex-probe.mjs` records which events fire.

## Reset

`/plugin uninstall keelson@keelson`, then remove `~/.agent` if you want to start from zero. The `.agent/` folders in your repositories are separate and yours.
