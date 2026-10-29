import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { claudeRows, isCodexRows } from "./codex.mjs";

const TAIL_BYTES = 1024 * 1024;

export function lastTurn(path) {
  let ctx = 0;
  let text = "";
  let model = "";
  let id = "";
  if (!path) return { ctx, text, model, id };
  let rows = [];
  try { rows = tailOf(path).split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { return { ctx, text, model, id }; }
  if (isCodexRows(rows)) rows = claudeRows(rows);
  for (let i = rows.length - 1; i >= 0 && (!ctx || !text || !model); i--) {
    const row = rows[i];
    const m = row.message || row;
    if (m.role !== "assistant") continue;
    if (!model && typeof m.model === "string" && !m.model.startsWith("<")) model = m.model;
    const u = m.usage || row.usage;
    if (!ctx && u) {
      ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      id = String(m.id || "");
    }
    if (!text) {
      const c = m.content;
      if (typeof c === "string") text = c;
      else if (Array.isArray(c)) text = c.filter((x) => x && x.type === "text" && typeof x.text === "string").map((x) => x.text).join("\n");
    }
  }
  return { ctx, text, model, id };
}

function tailOf(path) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}
