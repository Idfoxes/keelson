#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { CODE_EXT } from "./lib/checks.mjs";
import { logRun } from "./lib/hook-log.mjs";
import { agentIs, readRows } from "./lib/turn.mjs";

const SCOUT = "reuse-scout";
const FRESH_MS = 30 * 60 * 1000;
const STATE = join(homedir(), ".agent", "reuse-guard.json");
const EXEMPT = /(^|\/)(tests?|__tests__|spec|e2e|docs?|migrations|\.agent|scratch|fixtures)\//i;
const TEST_FILE = /(^|\/)(test_[^/]*|[^/]*_test\.\w+|[^/]*\.(test|spec)\.\w+|conftest\.py)$/i;
const DEFINITION = /^\s*(export\s+)?(async\s+)?(def|class|function|func|fun|interface|enum)\s+\w+|^\s*export\s+const\s+\w+\s*=\s*(async\s*)?\(|^\s*(public|private|protected)\s+[\w<>[\], ]+\s+\w+\s*\(/gm;

try {
  guard();
} catch {
  process.exit(0);
}
process.exit(0);

function guard() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  const input = d.tool_input || {};
  const path = String(input.file_path || "");
  if (!path || !CODE_EXT.has(extname(path)) || EXEMPT.test(path) || TEST_FILE.test(path)) return;
  const abs = isAbsolute(path) ? path : resolve(d.cwd || process.cwd(), path);
  if (!addsCode(d.tool_name, input, abs)) return;
  if (scoutedRecently(d.transcript_path)) return;
  const inSubagent = Boolean(d.agent_id);
  if (!firstTime((d.session_id || "?") + (inSubagent ? ":" + d.agent_id : ""))) return;
  logRun("reuse-guard", { file: abs.split("/").slice(-2).join("/"), inSubagent, tool: d.tool_name });
  const reason = inSubagent
    ? "Before writing new code, find what already exists: a subagent cannot call reuse-scout, so search yourself in one call, rg -n by name, by meaning and by a term from .agent/conventions.json, " +
      "and reuse what you find. Then repeat the write: the hook stays silent for the next 30 minutes."
    : "Before writing new code, find what already exists: call the reuse-scout subagent with one line “what I am writing and where”. It runs on Haiku and costs next to nothing, while a duplicate function or term gets caught later in review. " +
      "When you delegate code to a subagent, paste the reuse-scout answer into its task. If you already searched or the code is clearly new, repeat the write: the hook stays silent for the next 30 minutes.";
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
}

function addsCode(tool, input, abs) {
  if (tool === "Write") return !existsSync(abs);
  const pairs = tool === "MultiEdit" ? (input.edits || []) : [input];
  return pairs.some((e) => count(e.new_string) > count(e.old_string));
}

function count(text) {
  return (String(text || "").match(DEFINITION) || []).length;
}

function scoutedRecently(transcript) {
  const since = Date.now() - FRESH_MS;
  return readRows(transcript).some((row) => {
    const content = (row.message || row).content;
    if (!Array.isArray(content) || Date.parse(row.timestamp || "") < since) return false;
    return content.some((c) => c?.type === "tool_use" && /^(Agent|Task)$/.test(c.name) && agentIs(c.input?.subagent_type, SCOUT));
  });
}

function firstTime(session) {
  let state = {};
  try { state = JSON.parse(readFileSync(STATE, "utf8")) || {}; } catch { state = {}; }
  if (state[session] && Date.now() - Date.parse(state[session]) < FRESH_MS) return false;
  state[session] = new Date().toISOString();
  const keep = Object.entries(state).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 500);
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(Object.fromEntries(keep)) + "\n");
  return true;
}
