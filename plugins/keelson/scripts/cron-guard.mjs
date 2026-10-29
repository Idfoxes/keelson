#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { logRun } from "./lib/hook-log.mjs";
import { recordCronPrompt } from "./lib/cron-prompts.mjs";

const MIN_PERIOD = 30;

try {
  main();
} catch {
  process.exit(0);
}
process.exit(0);

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  const input = d.tool_input || {};
  const session = String(d.session_id || "");
  const cron = String(input.cron || "").trim();
  const recurring = input.recurring !== false;
  recordCronPrompt(session, input.prompt);
  const denied = recurring && tooFrequent(cron.split(/\s+/)[0] || "");
  logRun("cron-guard", { session: session.slice(0, 8), cron, recurring, denied });
  if (!denied) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Recurring reminders that wake the session more often than every ${MIN_PERIOD} minutes keep resending the whole context, so they are not allowed. ` +
        `` +
        `For a one-shot reminder use recurring: false with a pinned minute, hour, day and month. To watch a process, use Monitor instead of a recurring CronCreate.`,
    },
  }));
}

function tooFrequent(minute) {
  if (!minute) return false;
  const parts = minute.split(",");
  if (parts.length > 2) return true;
  return parts.some((p) => {
    if (p === "*" || p.includes("-")) return true;
    const step = /^\*\/(\d+)$/.exec(p);
    return step ? Number(step[1]) < MIN_PERIOD : false;
  });
}
