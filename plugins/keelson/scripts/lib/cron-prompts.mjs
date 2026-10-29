import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const FILE = join(homedir(), ".agent", "cron-prompts.json");
const KEEP_SESSIONS = 200;
const KEEP_PROMPTS = 50;
const HEAD = 200;

function head(prompt) {
  return String(prompt || "").trim().slice(0, HEAD);
}

function read() {
  try { return JSON.parse(readFileSync(FILE, "utf8")) || {}; } catch { return {}; }
}

export function recordCronPrompt(session, prompt) {
  const text = head(prompt);
  if (!session || !text) return;
  const state = read();
  const entry = state[session] || { prompts: [] };
  const prompts = [...entry.prompts.filter((p) => p !== text), text].slice(-KEEP_PROMPTS);
  state[session] = { at: new Date().toISOString(), prompts };
  const kept = Object.fromEntries(Object.entries(state).sort((a, b) => (a[1].at < b[1].at ? 1 : -1)).slice(0, KEEP_SESSIONS));
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(kept, null, 2) + "\n", "utf8");
}

export function isCronPrompt(session, prompt) {
  const text = head(prompt);
  if (!session || !text) return false;
  const entry = read()[session];
  return Array.isArray(entry?.prompts) && entry.prompts.includes(text);
}
