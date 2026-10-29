import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
const CODEX_TYPES = new Set(["session_meta", "event_msg", "response_item", "turn_context", "token_usage_record"]);
const SHELLS = /(^|\/)(bash|zsh|sh|dash)$/;
const OUTPUT_CHARS = 20000;
const HEAD_BYTES = 64 * 1024;
const SUB_FILES = 400;

export function isCodexRows(rows) {
  return rows.some((r) => r && CODEX_TYPES.has(r.type));
}

export function shellLine(command) {
  if (typeof command === "string") return command;
  if (!Array.isArray(command)) return "";
  if (command.length >= 3 && SHELLS.test(String(command[0])) && /^-\w*c$/.test(String(command[1]))) return String(command[2]);
  return command.map(String).join(" ");
}

function itemText(content) {
  return (Array.isArray(content) ? content : []).map((c) => (typeof c?.text === "string" ? c.text : "")).filter(Boolean).join("\n");
}

function usage(info) {
  const last = info?.last_token_usage;
  if (!last) return null;
  const cached = last.cached_input_tokens || 0;
  return { input_tokens: Math.max(0, (last.input_tokens || 0) - cached), cache_read_input_tokens: cached, output_tokens: last.output_tokens || 0 };
}

export function claudeRows(rows) {
  const out = [];
  let model = "";
  for (const r of rows) {
    const p = r?.payload || {};
    const timestamp = r?.timestamp;
    if (r?.type === "turn_context" && p.model) model = String(p.model);
    if (r?.type === "event_msg" && p.type === "token_count") {
      const u = usage(p.info);
      if (u) out.push({ type: "assistant", timestamp, message: { role: "assistant", id: `tokens-${r.ordinal ?? out.length}`, model, usage: u, content: [] } });
      continue;
    }
    if (r?.type !== "event_msg" || p.type !== "item_completed" || !p.item) continue;
    const it = p.item;
    if (it.type === "UserMessage") {
      out.push({ type: "user", timestamp, uuid: it.id, message: { role: "user", content: itemText(it.content) } });
    } else if (it.type === "AgentMessage") {
      const text = itemText(it.content);
      if (text) out.push({ type: "assistant", timestamp, message: { role: "assistant", id: it.id, model, content: [{ type: "text", text }] } });
    } else if (it.type === "CommandExecution") {
      const command = shellLine(it.command);
      out.push({ type: "assistant", timestamp, message: { role: "assistant", id: it.id, model, content: [{ type: "tool_use", id: it.id, name: "Bash", input: { command } }] } });
      const failed = typeof it.exit_code !== "number" || it.exit_code !== 0 || (it.status && it.status !== "completed");
      const text = String(it.aggregated_output || "").slice(0, OUTPUT_CHARS);
      out.push({ type: "user", timestamp, message: { role: "user", content: [{ type: "tool_result", tool_use_id: it.id, content: failed ? `Exit code ${it.exit_code}\n${text}` : text, is_error: failed }] } });
    } else if (it.type === "FileChange" && it.changes && typeof it.changes === "object" && (!it.status || it.status === "completed")) {
      const parts = Object.entries(it.changes).map(([path, change], n) => ({ type: "tool_use", id: `${it.id}-${n}`, name: change?.type === "add" ? "Write" : "Edit", input: { file_path: path } }));
      if (parts.length) out.push({ type: "assistant", timestamp, message: { role: "assistant", id: it.id, model, content: parts } });
    } else if (it.type === "SubAgentActivity" && it.kind === "started") {
      out.push({ type: "assistant", timestamp, message: { role: "assistant", id: it.id, model, content: [{ type: "tool_use", id: it.id, name: "Agent", input: { run_in_background: true, description: String(it.agent_path || "") } }] } });
    } else if (it.type === "McpToolCall") {
      out.push({ type: "assistant", timestamp, message: { role: "assistant", id: it.id, model, content: [{ type: "tool_use", id: it.id, name: `mcp__${it.server}__${it.tool}`, input: it.arguments || {} }] } });
    }
  }
  return out;
}

function head(path) {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(Math.min(HEAD_BYTES, statSync(path).size));
      readSync(fd, buf, 0, buf.length, 0);
      return JSON.parse(buf.toString("utf8").split("\n")[0]);
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

function dayDirs(from) {
  const dirs = [];
  for (let back = 0; back < 14; back += 1) {
    const d = new Date(from.getTime() - back * 86400000);
    dirs.push(join(CODEX_HOME, "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")));
  }
  return dirs.filter((d) => existsSync(d));
}

export function codexRollout(sessionId, now = new Date()) {
  if (!sessionId) return "";
  for (const dir of dayDirs(now)) {
    const hit = readdirSync(dir).find((f) => f.startsWith("rollout-") && f.endsWith(`${sessionId}.jsonl`));
    if (hit) return join(dir, hit);
  }
  return "";
}

export function transcriptPath(input) {
  return input?.transcript_path || codexRollout(input?.session_id);
}

export function isCodexRollout(path) {
  return /^rollout-.*\.jsonl$/.test(basename(String(path || ""))) && head(path)?.type === "session_meta";
}

export function codexSubagentFiles(path, since = 0) {
  const meta = head(path)?.payload || {};
  const ids = new Set([meta.id || meta.session_id].filter(Boolean));
  if (!ids.size) return [];
  const files = [...new Set([dirname(path), ...dayDirs(new Date())])]
    .flatMap((dir) => { try { return readdirSync(dir).filter((f) => f.startsWith("rollout-") && f.endsWith(".jsonl")).map((f) => join(dir, f)); } catch { return []; } })
    .filter((f) => f !== path)
    .map((f) => { try { return { f, m: statSync(f).mtimeMs }; } catch { return null; } })
    .filter((x) => x && (!since || x.m >= since))
    .sort((a, b) => a.m - b.m)
    .slice(-SUB_FILES);
  const metas = files.map((x) => ({ f: x.f, meta: head(x.f)?.payload || {} }));
  const picked = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const x of metas) {
      if (picked.includes(x.f) || !ids.has(x.meta.parent_thread_id)) continue;
      picked.push(x.f);
      ids.add(x.meta.id);
      grew = true;
    }
  }
  return picked;
}

function fileUrlPath(url) {
  try { return decodeURIComponent(url.slice("file://".length)); } catch { return url.slice("file://".length); }
}

export function sessionKey(id) {
  const s = String(id || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7/i.test(s) ? s.replace(/-/g, "").slice(-8) : s.slice(0, 8);
}

export function normalizeInput(input) {
  const d = input && typeof input === "object" ? input : {};
  const cwd = typeof d.cwd === "string" && d.cwd.startsWith("file://") ? fileUrlPath(d.cwd) : d.cwd;
  return { ...d, cwd, transcript_path: transcriptPath(d) };
}

function closingParen(src, from) {
  let depth = 1;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (c === "\\") { i += 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      for (i += 1; i < src.length && src[i] !== c; i += 1) if (src[i] === "\\") i += 1;
      continue;
    }
    if (c === "(") depth += 1;
    if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

function literal(text) {
  const t = text.trim();
  if (/^"(?:\\.|[^"\\])*"$/.test(t)) return JSON.parse(t);
  if (/^'(?:\\.|[^'\\])*'$/.test(t)) return t.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  if (/^`[^`$]*`$/.test(t)) return t.slice(1, -1);
  if (/^\[[\s\S]*\]$/.test(t)) {
    try { return shellLine(JSON.parse(t.replace(/'/g, '"'))); } catch { return null; }
  }
  return null;
}

function approximate(expr) {
  return [...expr.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|[A-Za-z_$][\w$.]*/g)]
    .map(([t]) => (/^["'`]/.test(t) ? (literal(t.replace(/\$\{[^}]*\}/g, "$X")) ?? t.slice(1, -1)) : "$" + t.replace(/\W/g, "_")))
    .join("");
}

function execCalls(code) {
  const src = String(code);
  const out = [];
  let unresolved = false;
  for (const m of src.matchAll(/exec_command\s*\(/g)) {
    const from = m.index + m[0].length;
    const to = closingParen(src, from);
    const arg = to < 0 ? src.slice(from) : src.slice(from, to);
    const value = arg.match(/["']?cmd["']?\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\[[^\]]*\])\s*(?=[,}])/);
    const cmd = value ? literal(value[1]) : null;
    if (cmd !== null) { out.push(cmd); continue; }
    const expr = arg.match(/["']?cmd["']?\s*:\s*((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|[^,}])+)/);
    if (expr) out.push(approximate(expr[1]));
    else unresolved = true;
  }
  if (unresolved) out.push(src);
  return out;
}

export function toolCommands(input) {
  if (typeof input === "string") {
    const calls = execCalls(input);
    return calls.length ? calls : /exec_command/.test(input) ? [input] : [];
  }
  if (!input || typeof input !== "object") return [];
  const out = [];
  for (const key of ["command", "cmd"]) {
    if (typeof input[key] === "string" || Array.isArray(input[key])) out.push(shellLine(input[key]));
  }
  for (const key of ["code", "input", "source", "script"]) {
    if (typeof input[key] === "string") out.push(...toolCommands(input[key]));
  }
  return out.filter(Boolean);
}
