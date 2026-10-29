import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { CODE_EXT } from "./checks.mjs";
import { claudeRows, codexSubagentFiles, isCodexRollout, isCodexRows } from "./codex.mjs";
import { EDIT_TOOLS, isHumanPrompt } from "./turn.mjs";

const TAIL_BYTES = 6 * 1024 * 1024;
const SUB_TAIL_BYTES = 1024 * 1024;
const SUB_FILES = 40;
const OUTPUT_CHARS = 20000;

function tailRows(path, limit = TAIL_BYTES) {
  if (!path || !existsSync(path)) return [];
  const size = statSync(path).size;
  const len = Math.min(size, limit);
  const buf = Buffer.alloc(len);
  const fd = openSync(path, "r");
  try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
  const lines = buf.toString("utf8").split("\n");
  if (size > len) lines.shift();
  const rows = lines.filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  return isCodexRows(rows) ? claudeRows(rows) : rows;
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : c?.text || "")).join("\n");
  return "";
}

function collect(rows, since = 0) {
  const calls = new Map();
  const order = [];
  for (const row of rows) {
    if (since && Date.parse(row.timestamp || "") < since) continue;
    const content = (row.message || row).content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === "tool_use") {
        const input = c.input || {};
        const call = { id: c.id, ts: Date.parse(row.timestamp || "") || 0, name: c.name, input, command: String(input.command || ""), path: String(input.file_path || input.notebook_path || input.path || ""), ok: null, output: "" };
        calls.set(c.id, call);
        order.push(call);
      } else if (c?.type === "tool_result" && calls.has(c.tool_use_id)) {
        const call = calls.get(c.tool_use_id);
        call.output = resultText(c.content).slice(0, OUTPUT_CHARS);
        call.ok = c.is_error !== true && !/^Exit code [1-9]/m.test(call.output);
      }
    }
  }
  return order;
}

function subagentRows(transcript, since) {
  if (isCodexRollout(transcript)) return codexSubagentFiles(transcript, since).flatMap((f) => tailRows(f, SUB_TAIL_BYTES));
  const dir = join(dirname(transcript), basename(transcript, ".jsonl"), "subagents");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .filter((x) => !since || x.m >= since).sort((a, b) => b.m - a.m).slice(0, SUB_FILES).map((x) => x.f);
  } catch {
    return [];
  }
  return files.flatMap((f) => tailRows(join(dir, f), SUB_TAIL_BYTES));
}

const SCRATCH = /(^|\/)(tmp|private\/tmp|private\/var\/folders|var\/folders)\/|\/\.agent\/scratch\//;

export function finalTurn(transcript) {
  const rows = tailRows(transcript);
  let start = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isHumanPrompt(rows[i])) { start = i + 1; break; }
  }
  const startedAt = start ? Date.parse(rows[start - 1].timestamp || "") || 0 : 0;
  let text = "";
  for (const row of rows.slice(start)) {
    const m = row.message || row;
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const t = m.content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
      if (t) text = t;
    }
  }
  return { rows, start, startedAt, text, key: start ? String(rows[start - 1].uuid || rows[start - 1].timestamp || start) : "0" };
}

function lastCodeEdit(calls) {
  return Math.max(0, ...calls.filter((c) => EDIT_TOOLS.has(c.name) && CODE_EXT.has(extname(c.path)) && !SCRATCH.test(c.path)).map((c) => c.ts));
}

export function toolCalls(transcript, ft) {
  const sub = transcript ? collect(subagentRows(transcript, 0)) : [];
  const turn = [...collect(ft.rows.slice(ft.start)), ...sub.filter((c) => !ft.startedAt || c.ts >= ft.startedAt)];
  const session = [...collect(ft.rows), ...sub];
  const sessionEdit = lastCodeEdit(session);
  const turnEdit = lastCodeEdit(turn);
  return {
    turn, session,
    afterEdit: session.filter((c) => !sessionEdit || c.ts >= sessionEdit),
    turnAfterEdit: turn.filter((c) => !turnEdit || c.ts >= turnEdit),
  };
}

export function evidence(transcript) {
  const ft = finalTurn(transcript);
  return { ...ft, ...toolCalls(transcript, ft) };
}
