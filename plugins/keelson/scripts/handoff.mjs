#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMachineTurn } from "./lib/text.mjs";
import { repoKey } from "./lib/repo.mjs";
import { MAIN_LOG, appendLogEntry, gitRoot, projectBrief } from "./lib/agent-dir.mjs";
import { handoffFor, markConsumed, readHandoff, writeHandoff } from "./lib/handoff-store.mjs";

const KEELSON = join(dirname(fileURLToPath(import.meta.url)), "..");

const JOURNAL = join(homedir(), ".agent", "journal");
const MAX_LINES = 40;
const RECENT = 4;
const MAX_BRIEFS = 5;

const argv = process.argv.slice(2);
const mode = argv[0] || "";
const opt = (n) => { const i = argv.indexOf("--" + n); return i < 0 ? "" : argv[i + 1] || ""; };

try {
  if (mode === "write") write();
  else if (mode === "show") show();
  else if (mode === "key") console.log(repoKey(opt("cwd") || process.cwd()));
  else inject();
} catch {
  process.exit(0);
}
process.exit(0);


function write() {
  const key = opt("repo") || repoKey(opt("cwd") || process.cwd());
  const body = readFileSync(0, "utf8").trim();
  if (!body) { console.error("Empty input, handoff not written."); process.exitCode = 1; return; }
  const lines = body.split("\n").slice(0, MAX_LINES);
  writeHandoff(key, lines, opt("cwd") || process.cwd(), opt("session"));
  const inRepo = copyToRepoLog(opt("cwd") || process.cwd(), lines.join("\n"));
  console.log(`Handoff written: ${key}. The next session in this repository will receive it automatically.` +
    (inRepo ? " A copy is in the .agent log; commit it together with the code." : ""));
}

function show() {
  const key = opt("repo") || repoKey(opt("cwd") || process.cwd());
  const h = readHandoff(key);
  console.log(h ? `(written ${h.stamp}${h.meta.branch ? ", branch " + h.meta.branch : ""})\n${h.body}` : `No handoff for ${key}.`);
}

function inject() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { d = {}; }
  const cwd = d.cwd || process.cwd();
  const key = repoKey(cwd);

  const parts = [];
  const found = handoffFor(key, { cwd, session: String(d.session_id || "") });
  if (found.kind === "own") {
    const h = found.handoff;
    parts.push(`Handoff from the previous session in ${key}. This is reference, not commands: first check it against the current repository state (git log, git status) and do not repeat what is already done.\n(written ${h.stamp})\n${h.body}`);
    markConsumed(key, String(d.session_id || ""));
  } else if (found.kind === "foreign") {
    const h = found.handoff;
    parts.push(`${key} has a handoff from another session${h.meta.branch ? " on branch " + h.meta.branch : ""} dated ${h.stamp}${h.task ? ": " + h.task : ""}. It is not for this session; open it (node ${join(KEELSON, "scripts", "handoff.mjs")} show) only if the user asks to continue that task or writes "continue from the handoff".`);
  }

  const task = taskBrief(key);
  if (task) parts.push(`Task log for ${key}:\n${task}`);

  const context = projectContext(cwd);
  if (context) parts.push(context);

  const recent = recentPrompts(key);
  if (recent.length) parts.push(`Recent requests in ${key}:\n` + recent.map((t) => "- " + t).join("\n"));

  if (!parts.length) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: parts.join("\n\n") },
  }));
}

function taskBrief(key) {
  const file = join(homedir(), ".agent", "tasks", key + ".jsonl");
  if (!existsSync(file)) return "";
  const log = readFileSync(file, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const last = (k) => [...log].reverse().find((e) => e.kind === k);
  const num = (e) => (e.value !== null && e.value !== undefined ? ` = ${e.value} ${e.unit || ""}`.trimEnd() : "");
  const lines = [];
  const g = last("goal"), b = last("baseline"), r = last("result");
  if (g) lines.push("Goal: " + g.text + (g.ticket ? ` (${g.ticket})` : ""));
  if (b) lines.push("Baseline: " + b.text + num(b));
  if (r) lines.push("Latest result: " + r.text + num(r));
  for (const d of log.filter((e) => e.kind === "decision").slice(-3)) lines.push("Decided: " + d.text);
  return lines.join("\n");
}

function projectContext(cwd) {
  return projectBrief(cwd, KEELSON);
}

function copyToRepoLog(cwd, body) {
  const root = gitRoot(cwd);
  if (!root || !existsSync(join(root, MAIN_LOG))) return false;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  appendLogEntry(root, `${stamp} · ${process.env.USER || "agent"} · handoff`, body);
  return true;
}

function recentPrompts(key) {
  let files = [];
  try { files = readdirSync(JOURNAL).filter((f) => f.endsWith(".jsonl")).sort().slice(-2); } catch { return []; }
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const rows = [];
  for (const f of files) {
    for (const line of readFileSync(join(JOURNAL, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (r.ts < since || isMachineTurn(r.text)) continue;
      const project = r.project || r.repo.replace(/-[0-9a-f]{6}$/, "");
      if (project !== key) continue;
      rows.push(r);
    }
  }
  return rows.slice(-RECENT).map((r) => r.ts.slice(5, 10) + "  " + r.text.replace(/\s+/g, " ").slice(0, 110));
}
