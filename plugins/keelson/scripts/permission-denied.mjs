#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { redact } from "./lib/redact.mjs";

const FILE = join(homedir(), ".agent", "denials.jsonl");
const WINDOW_MS = 10 * 60 * 1000;
const RETRIES = 3;
const TAIL = 300;
const REASON_CHARS = 160;

try {
  record();
} catch {
  process.exit(0);
}
process.exit(0);

function record() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  const session = String(d.session_id || "").slice(0, 8);
  const now = Date.now();
  const recent = history().filter((r) => r.session === session && now - Date.parse(r.ts) < WINDOW_MS).length;

  mkdirSync(dirname(FILE), { recursive: true });
  appendFileSync(FILE, JSON.stringify({
    ts: new Date(now).toISOString(),
    session,
    tool: d.tool_name || "?",
    target: firstWord(d.tool_input),
    mode: d.permission_mode || "",
    reason: redact(String(d.reason || "")).text.replace(/\s+/g, " ").trim().slice(0, REASON_CHARS),
    keys: Object.keys(d).sort(),
  }) + "\n", "utf8");

  if (process.env.KEELSON_AUTO_RETRY !== "1" || recent >= RETRIES) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionDenied", retry: true } }));
}

function firstWord(input) {
  const i = input || {};
  const text = String(i.command || i.file_path || i.path || i.url || "");
  return text.trim().split(/\s+/)[0].slice(0, 60);
}

function history() {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, "utf8").split("\n").filter(Boolean).slice(-TAIL)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}
