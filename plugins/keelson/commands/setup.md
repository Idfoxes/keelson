---
description: One-time Keelson setup. Checks the environment, creates the data folder, proves the hooks write data, and schedules the weekly review.
allowed-tools: Bash(node:*), Bash(crontab:*), Bash(command:*), Bash(uname:*), Bash(mkdir:*), Bash(ls:*), Bash(git:*), Read
---

Set Keelson up for this user. Take the defaults below and do not ask questions, except the one marked ASK. Report each step as done, skipped or failed, with the reason.

1. Requirements: run `node --version` and `git --version`. Node must be 18 or newer. If not, stop and say what to install.
2. Data folder: `node -e 'require("fs").mkdirSync(require("os").homedir()+"/.agent/reviews",{recursive:true})'`.
3. Hooks proof: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/context-ledger.mjs --cost --days 7`. "No data yet" is fine in a new install; a crash is a failure. Tell the user that the hooks load only in a session started after the install, and that data starts to appear after a few prompts.
4. Weekly review schedule, default Monday 09:00 local time:
   - Find the Claude Code binary with `command -v claude`. If it is missing, skip this step and say so.
   - Read the current table with `crontab -l`. If a line ending in `# keelson-weekly-review` exists, skip: the schedule is already set.
   - ASK once, only if the machine is not macOS or Linux: say that no scheduler is configured and give the command to run by hand.
   - Otherwise append one line with `crontab`, keeping every existing line:
     `0 9 * * 1 cd "$HOME" && <claude path> -p "/keelson:weekly-review" --allowedTools "Bash(node:*) Read Write" >> "$HOME/.agent/reviews/cron.log" 2>&1 # keelson-weekly-review`
   - Print the line you added and how to remove it: `crontab -e`, delete the line that ends in `# keelson-weekly-review`.
   - On macOS, cron may need Full Disk Access to run. Say this in one sentence; do not change system settings.
5. Final message, four lines at most: what was set up, when the first report will appear (next Monday 09:00, file `~/.agent/reviews/<date>.md`), the command to run it now (`/keelson:weekly-review`), the command to see the dashboard (`node ${CLAUDE_PLUGIN_ROOT}/scripts/dashboard.mjs`).

Never edit settings.json, CLAUDE.md, AGENTS.md or rule files in this command. The weekly review only proposes changes; the user applies them.
