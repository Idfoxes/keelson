import { readFileSync } from "node:fs";
import { claudeRows, isCodexRows } from "./codex.mjs";

export const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
export const DONE_CLAIM = /(^|[^\p{L}])(?<!(?:^|[^\p{L}])(?:не|not|isn't|doesn't)\s)(готово|сделано|сделал|исправлено|исправил|починил|починено|работает|проверено|done|fixed|works)(?![\p{L}])/iu;
export const ADMITS_UNVERIFIED = /не провер|не запуска|не тестировал|unverified|not verified|not tested/i;

export function readRows(path) {
  if (!path) return [];
  let raw = "";
  try { raw = readFileSync(path, "utf8"); } catch { return []; }
  const rows = raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return isCodexRows(rows) ? claudeRows(rows) : rows;
}

export function agentIs(type, name) {
  const t = String(type || "");
  return t === name || t.endsWith(":" + name);
}

const HOOK_FEEDBACK = /^\s*(Stop hook feedback|<system-reminder>|\[Request interrupted)/;

export function isHumanPrompt(row) {
  const message = row.message || row;
  if (message.role !== "user" || row.isMeta) return false;
  const text = typeof message.content === "string" ? message.content
    : Array.isArray(message.content) && !message.content.some((c) => c?.type === "tool_result") ? message.content.filter((c) => c?.type === "text").map((c) => c.text).join("\n") : null;
  return text !== null && !HOOK_FEEDBACK.test(text);
}

export function currentTurn(path) {
  const rows = readRows(path);
  let start = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isHumanPrompt(rows[i])) { start = i + 1; break; }
  }
  const startedAt = start ? Date.parse(rows[start - 1].timestamp || "") || 0 : 0;
  const tools = [];
  let text = "";
  for (const row of rows.slice(start)) {
    const message = row.message || row;
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part?.type === "tool_use") {
        const input = part.input || {};
        tools.push({ name: part.name, path: String(input.file_path || input.notebook_path || ""), command: String(input.command || ""), input });
      }
      if (part?.type === "text" && part.text) text = part.text;
    }
  }
  return { tools, text, startedAt, key: start ? String(rows[start - 1].uuid || rows[start - 1].timestamp || start) : "0" };
}
