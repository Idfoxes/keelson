#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { toolCommands } from "./lib/codex.mjs";
import { redact } from "./lib/redact.mjs";

const FILE = join(homedir(), ".agent", "codex-probe.jsonl");
const MAX_BYTES = 300 * 1024;

try {
  let size = 0;
  try { size = statSync(FILE).size; } catch { size = 0; }
  if (size < MAX_BYTES) {
    const d = JSON.parse(readFileSync(0, "utf8")) || {};
    const command = toolCommands(d.tool_input)[0] || "";
    const row = {
      ts: new Date().toISOString(),
      event: d.hook_event_name || "",
      session: String(d.session_id || "").slice(0, 12),
      keys: Object.keys(d).sort(),
      tool: d.tool_name || "",
      inputKeys: d.tool_input && typeof d.tool_input === "object" ? Object.keys(d.tool_input).sort() : typeof d.tool_input,
      command: redact(command.slice(0, 80)).text,
      transcript: Boolean(d.transcript_path),
      cwd: typeof d.cwd === "string" ? d.cwd.slice(0, 7) : "",
    };
    mkdirSync(dirname(FILE), { recursive: true });
    appendFileSync(FILE, JSON.stringify(row) + "\n");
  }
} catch {
  process.exit(0);
}
process.exit(0);
