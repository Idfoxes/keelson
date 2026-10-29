#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { normalizeInput, isCodexRollout } from "./lib/codex.mjs";
import { finalTurn, toolCalls } from "./lib/evidence.mjs";
import { logRun } from "./lib/hook-log.mjs";

const PROMISE = /(?<![\p{L}])(?<!не\s)(?<!not\s)(продолжу\s+(сам|сама|автоматически)|вернусь\s+сам|сам\s+продолжу)(?![\p{L}?])|I(?:'ll|\s+will)\s+(?:continue|resume)\s+(?:on\s+my\s+own|by\s+myself|automatically)|I(?:'ll|\s+will)\s+come\s+back\s+on\s+my\s+own/iu;
const WAKERS = /^(Monitor|CronCreate|ScheduleWakeup)$|send_later|create_trigger/;
const WINDOW_MS = 12 * 3600 * 1000;

try {
  main();
} catch {
  process.exit(0);
}
process.exit(0);

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  d = normalizeInput(d);
  if (d.stop_hook_active) return;
  const ft = finalTurn(d.transcript_path);
  const text = ft.text || String(d.last_assistant_message || "");
  if (!PROMISE.test(text.replace(/```[\s\S]*?```|`[^`\n]*`|«[^»\n]*»|"[^"\n]*"/g, " "))) return;
  const since = Date.now() - WINDOW_MS;
  const calls = toolCalls(d.transcript_path, ft).session.filter((c) => !c.ts || c.ts >= since);
  if (calls.some((c) => WAKERS.test(c.name) || c.input?.run_in_background === true)) return;
  const codex = isCodexRollout(d.transcript_path);
  logRun("wake-guard", { codex });
  const fix = codex
    ? "Codex has no alarm: replace the promise with “I will not wake up on my own: write ‘continue’ after HH:MM local time” and give an honest time."
    : "If you are waiting for a time, CI, another session or an external run, set a one-shot reminder for the named time: CronCreate with recurring: false and a pinned minute, hour, day and month (load it through ToolSearch “select:CronCreate”), with one line in the text on what to check. If there is no such tool, replace the promise with “I will not wake up on my own: write ‘continue’ after HH:MM local time”.";
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `The reply promises to continue on its own, but nothing can wake the session: in the last 12 hours there was no background task, Monitor, background subagent or reminder. ${fix} Change nothing else.`,
  }));
}
