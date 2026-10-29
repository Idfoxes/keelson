#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { SHARED_RECORDS, currentBranch, defaultBranch, isTaskBranch, logFile } from "./lib/agent-dir.mjs";
import { TRUST_STORE } from "./lib/destructive.mjs";
import { globToRegex } from "./lib/glob.mjs";
import { logRun } from "./lib/hook-log.mjs";
import { canonical } from "./lib/paths.mjs";
import { redact } from "./lib/redact.mjs";

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const WRITES = /(>>?|\bsed\s+-i|\btee\b|\bmv\b|\brm\b|\bcp\b|\btruncate\b|\bperl\s+-i|\bchmod\b|\bln\b|\bgit\s+(checkout|restore|rm)\b)/;
const RECORD_MENTION = /\.agent\/(?:context|log|decisions)\.md/;
const RECORD_PATH = String.raw`[^\s"'<>|;&]*\.agent\/(?:context|log|decisions)\.md`;
const REDIRECT = new RegExp(String.raw`(?<![-=])>>?\s*["']?(${RECORD_PATH})(?![\w.-])`);
const DD_OUTPUT = new RegExp(String.raw`\bof=["']?(${RECORD_PATH})(?![\w.-])`);
const ENDS_IN_RECORD = new RegExp(String.raw`^(${RECORD_PATH})$`);
const IN_PLACE = /(?:^|\s)(?:-[a-zA-Z]*i[a-zA-Z.]*|--in-place(?:=\S*)?)(?=\s|$|["'])/;
const COPY_COMMAND = /(?:^|\s)(?:mv|cp|install)(?=\s)/;
const REASON_COMMAND_CHARS = 100;

try {
  guard();
} catch {
  process.exit(0);
}
process.exit(0);

function guard() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  const cwd = d.cwd || process.cwd();
  const tool = d.tool_name || "";
  const input = d.tool_input || {};
  const verdict = trustVerdict(cwd, tool, input) || recordsVerdict(cwd, tool, input) || protectedVerdict(cwd, tool, input);
  if (!verdict) return;

  const command = tool === "Bash" ? { command: redact(String(input.command || "")).text.slice(0, REASON_COMMAND_CHARS) } : {};
  logRun("protect-guard", { rule: verdict.rule, tool, repo: basename(verdict.root), file: verdict.file, ...(verdict.branch ? { branch: verdict.branch } : {}), ...command, session: String(d.session_id || "").slice(0, 8) });
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: verdict.reason,
    },
  }));
}

function trustVerdict(cwd, tool, input) {
  if (!FILE_TOOLS.has(tool)) return null;
  const file = String(input.file_path || input.notebook_path || "");
  if (!TRUST_STORE.test(file)) return null;
  return {
    rule: "trust-store",
    root: canonical(gitTop(cwd)),
    file,
    reason: "The user alone changes the trusted-repositories list of the quality gate: turn_checks run commands from it without asking. Do not touch the file; ask the user in the chat.",
  };
}

function recordsVerdict(cwd, tool, input) {
  if (FILE_TOOLS.has(tool)) {
    const path = input.file_path || input.notebook_path || "";
    const abs = canonical(isAbsolute(path) ? path : resolve(cwd, path));
    const root = canonical(gitTop(nearestDir(dirname(abs))));
    const rel = relative(root, abs);
    return SHARED_RECORDS.includes(rel) ? onTaskBranch(root, rel) : null;
  }
  if (tool !== "Bash") return null;
  const command = String(input.command || "");
  if (!RECORD_MENTION.test(command)) return null;
  const written = writtenRecord(command);
  if (!written) return null;
  const root = canonical(gitTop(cwd));
  const rel = SHARED_RECORDS.find((r) => written.endsWith(r)) || written;
  return onTaskBranch(root, rel);
}

function onTaskBranch(root, file) {
  const branch = currentBranch(root);
  if (!isTaskBranch(root, branch)) return null;
  const base = defaultBranch(root);
  return {
    rule: "records",
    root,
    file,
    branch,
    reason: `Branch "${branch}" is neither the default branch nor records-*, so ${file} is not edited on it: the shared records ` +
      `(${SHARED_RECORDS.join(", ")}) change only on the default branch and on records-*. ` +
      `Write the session record, state and decisions to ${logFile(root)} with the agent-context.mjs log command. ` +
      `To restore the file as on the default branch: git checkout origin/${base} -- ${file}. ` +
      `If the edit belongs in the shared record, make it on a branch named records-<topic>.`,
  };
}

function writtenRecord(command) {
  for (const segment of segmentsOf(command)) {
    const hit = recordWrittenBy(segment);
    if (hit) return hit;
  }
  return "";
}

function segmentsOf(command) {
  const segments = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (quote) {
      current += c;
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && next !== undefined) current += command[++i];
    } else if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === "\\" && next !== undefined) {
      current += c + command[++i];
    } else if (c === ">" && next === "|") {
      current += c;
      i++;
    } else if (c === ";" || c === "\n" || c === "|" || (c === "&" && next === "&")) {
      segments.push(current);
      current = "";
      if ((c === "|" && next === "|") || c === "&") i++;
    } else {
      current += c;
    }
  }
  segments.push(current);
  return segments;
}

function recordWrittenBy(segment) {
  const redirect = REDIRECT.exec(segment) || DD_OUTPUT.exec(segment);
  if (redirect) return redirect[1];
  const target = new RegExp(RECORD_PATH).exec(segment);
  if (!target) return "";
  if (/\btee\b|\btruncate\b/.test(segment)) return target[0];
  if (/\b(?:sed|perl)\b/.test(segment) && IN_PLACE.test(segment)) return target[0];
  if (COPY_COMMAND.test(segment)) return copyDestination(segment);
  return "";
}

function copyDestination(segment) {
  const args = segment.trim().split(/\s+/).filter((t) => !t.startsWith("-"));
  const last = (args[args.length - 1] || "").replace(/^["']|["']$/g, "");
  const match = ENDS_IN_RECORD.exec(last);
  return match ? match[1] : "";
}

function protectedVerdict(cwd, tool, input) {
  const root = canonical(gitTop(cwd));
  const list = join(root, ".agent", "protected");
  if (!existsSync(list)) return null;
  const patterns = readFileSync(list, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!patterns.length) return null;

  let hit = null;
  let file = "";
  if (FILE_TOOLS.has(tool)) {
    const path = input.file_path || input.notebook_path || "";
    file = relative(root, canonical(isAbsolute(path) ? path : resolve(cwd, path)));
    hit = patterns.find((p) => globToRegex(p).test(file));
  } else if (tool === "Bash") {
    const command = String(input.command || "");
    if (WRITES.test(command)) hit = patterns.find((p) => command.includes(literalPrefix(p)));
    file = hit || "";
  }
  if (!hit) return null;
  return {
    rule: "protected",
    root,
    file,
    reason: `"${hit}" is protected by the user (.agent/protected): the goal, prohibitions, deferred data and estimates are changed only by the user. ` +
      `If the edit is needed, describe it to the user in one line and continue without it.`,
  };
}

function literalPrefix(glob) {
  return glob.split(/[*?]/)[0].replace(/\/$/, "") || glob;
}

function nearestDir(dir) {
  let current = dir;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function gitTop(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim() || dir;
  } catch {
    return dir;
  }
}
