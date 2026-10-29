#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { normalizeInput, toolCommands } from "./lib/codex.mjs";
import { SECRET_READ, TRUST_STORE, destructiveReasons } from "./lib/destructive.mjs";
import { logRun } from "./lib/hook-log.mjs";
import { redact } from "./lib/redact.mjs";
import { repoKey } from "./lib/repo.mjs";

const WORKTREE_ONLY = /^git (reset --hard|clean removes|checkout|restore) /;
const APPROVALS = join(homedir(), ".agent", "destructive-approvals.json");
const APPROVAL_TTL_MS = 30 * 60 * 1000;
const YES = /^\s*(да|ага|давай|запускай|запусти|подтверждаю|ок|окей|ok|okay|yes|yep|sure|confirm|confirmed|proceed|go)(\s*[,.!]*\s*(удаляй|запускай|делай|давай|можно|go|ahead|do it|delete it|run it))?\s*[.!)]*\s*$/iu;
const STATE_FILE = /destructive-approvals\.json/;
const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const TRUST_HINT = "The user alone changes the trusted-repositories list of the quality gate: turn_checks run commands from it without asking. Do not touch the file and do not call trust; ask the user in the chat.";
const SECRET_HINT = "The agent does not read values from the Keychain. If the value is really needed, tell the user which one and why, and continue without it.";
const ASK_HINT = "Before running, state in your reply: the exact command, what will be lost and how much (objects, files, rows), who else uses it, and how to roll back.";

try {
  main();
} catch {
  process.exit(0);
}
process.exit(0);

function main() {
  const mode = process.argv[2] || "";
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  d = normalizeInput(d);
  if (mode === "--approve") return approve(d);
  const codex = mode === "--codex";
  if (FILE_TOOLS.has(d.tool_name)) return guardTrustStore(String(d.tool_input?.file_path || d.tool_input?.notebook_path || ""), d.cwd || process.cwd());
  if (!codex && d.tool_name && d.tool_name !== "Bash") return;
  const commands = codex ? toolCommands(d.tool_input) : [String(d.tool_input?.command || "")];
  const cwd = d.cwd || process.cwd();
  if (commands.some((c) => TRUST_STORE.test(c))) return guardTrustStore(commands.join("\n"), cwd);
  if (commands.some((c) => STATE_FILE.test(c))) return decide("deny", "The destructive-command approvals file is changed only by the hook, based on the user's reply. Do not touch it; ask the user in chat.", cwd, "edit of the approvals file");
  const found = commands.map((command) => ({ command, reasons: reasonsOf(command, cwd) })).filter((x) => x.reasons.length);
  if (!found.length) return;
  const reasons = [...new Set(found.flatMap((x) => x.reasons))];
  const secrets = reasons.filter((r) => r.startsWith(SECRET_READ));
  if (secrets.length) return decide("deny", `${secrets.join("; ")}. ${SECRET_HINT}`, cwd, secrets.join("; "));
  const reason = reasons.join("; ");
  if (!codex) return decide("ask", `Destructive operation: ${reason}. ${ASK_HINT} Run it?`, cwd, reason, found[0].command);
  const session = String(d.session_id || "");
  if (consume(session, found.map((x) => x.command))) {
    try { logRun("destructive-guard", { repo: repoKey(cwd), reason, decision: "approved", command: redact(found[0].command).text.slice(0, 200) }); } catch { return; }
    return;
  }
  decide("deny", `Destructive operation: ${reason}. ${ASK_HINT} Ask the user in chat and end the turn. After the user replies "yes", repeat the same command unchanged: it will run once within 30 minutes.`, cwd, reason, found[0].command);
  try { remember(session, found.map((x) => x.command)); } catch { return; }
}

function guardTrustStore(text, cwd) {
  if (TRUST_STORE.test(text)) decide("deny", TRUST_HINT, cwd, "edit of the trusted-repositories list");
}

function reasonsOf(command, cwd) {
  let reasons = [];
  try { reasons = destructiveReasons(command); } catch { reasons = ["could not parse the command"]; }
  if (reasons.some((r) => WORKTREE_ONLY.test(r)) && cleanTree(command, cwd)) reasons = reasons.filter((r) => !WORKTREE_ONLY.test(r));
  return reasons;
}

function decide(decision, text, cwd, reason, command = "") {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: text } }));
  try { logRun("destructive-guard", { repo: repoKey(cwd), reason, decision, ...(command ? { command: redact(command).text.slice(0, 200) } : {}) }); } catch { return; }
}

function normalized(command) {
  return String(command).replace(/\s+/g, " ").trim();
}

function readApprovals() {
  try { return JSON.parse(readFileSync(APPROVALS, "utf8")) || {}; } catch { return {}; }
}

function saveApprovals(state) {
  const now = Date.now();
  const kept = Object.fromEntries(Object.entries(state).filter(([, v]) => now - Date.parse(v.at || 0) < APPROVAL_TTL_MS));
  mkdirSync(dirname(APPROVALS), { recursive: true });
  writeFileSync(APPROVALS, JSON.stringify(kept) + "\n");
}

function remember(session, commands) {
  if (!session) return;
  const state = readApprovals();
  state[session] = { at: new Date().toISOString(), commands: commands.map(normalized), approved: false };
  saveApprovals(state);
}

function approve(d) {
  const session = String(d.session_id || "");
  const state = readApprovals();
  const pending = state[session];
  if (!pending || pending.approved || Date.now() - Date.parse(pending.at) > APPROVAL_TTL_MS) return;
  if (!YES.test(String(d.prompt || ""))) return;
  state[session] = { ...pending, approved: true, at: new Date().toISOString() };
  saveApprovals(state);
}

function consume(session, commands) {
  const state = readApprovals();
  const pending = state[session];
  if (!pending?.approved || Date.now() - Date.parse(pending.at) > APPROVAL_TTL_MS) return false;
  const wanted = commands.map(normalized);
  if (!wanted.every((c) => pending.commands.includes(c))) return false;
  delete state[session];
  saveApprovals(state);
  return true;
}

function cleanTree(command, cwd) {
  const unquote = (p) => p.replace(/^["']|["']$/g, "").replace(/^~(?=\/|$)/, homedir());
  const dirs = [...command.matchAll(/git\s+-C\s+("[^"]+"|'[^']+'|\S+)/g)].map((m) => m[1]);
  const cds = [...command.matchAll(/(?:^|[;&|(]\s*)cd\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/g)].map((m) => m[1]);
  const targets = dirs.length ? dirs : [cds.at(-1) || "."];
  return targets.every((raw) => {
    const dir = unquote(raw);
    if (/[$`*]/.test(dir)) return false;
    try {
      return execFileSync("git", ["-C", resolve(cwd, dir), "status", "--porcelain"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim() === "";
    } catch {
      return false;
    }
  });
}
