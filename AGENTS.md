# Install Keelson (instructions for a coding agent)

A user sent you this repository link and asked you to install it. Do these steps in order. Do not ask questions unless a step says so.

1. Check Node 18+ and git: `node --version && git --version`.
2. Install the plugin with the CLI (these are shell commands, you can run them yourself):
   ```
   claude plugin marketplace add Idfoxes/keelson
   claude plugin install keelson@keelson
   ```
   If `claude` is not found, you are not in Claude Code. Tell the user to run `/plugin marketplace add Idfoxes/keelson` and `/plugin install keelson@keelson` in Claude Code, then stop.
3. Tell the user: hooks load in a new session. Ask them to open one, then run `/keelson:setup`. That command creates the data folder, checks the hooks and schedules the weekly review (Monday 09:00 local time, one cron line, removable). You may run its steps yourself with the same commands if the plugin is already loaded in this session.
4. Codex users: run `bash install-codex.sh` from a clone of this repository instead of steps 2 and 3.

What Keelson does and does not do: it records turns and tool calls as plain files under `~/.agent` on this machine, runs checks when a turn ends, and writes a weekly report with proposed rules. It sends nothing anywhere. It never edits your rules or settings by itself. Details: README.md, SECURITY.md, docs/ARCHITECTURE.md.
