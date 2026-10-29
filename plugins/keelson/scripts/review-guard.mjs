#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { CODE_EXT } from "./lib/checks.mjs";
import { ADMITS_UNVERIFIED, DONE_CLAIM, EDIT_TOOLS, agentIs, readRows } from "./lib/turn.mjs";

const REVIEWER = "diff-reviewer";
const MIN_LINES = Number(process.env.KEELSON_REVIEW_MIN_LINES || 50);
const STATE = join(homedir(), ".agent", "review-guard.json");

try {
  main();
} catch {
  process.exit(0);
}
process.exit(0);

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  const rows = readRows(d.transcript_path);
  const text = lastText(rows);
  if (!DONE_CLAIM.test(text) || ADMITS_UNVERIFIED.test(text)) return;
  const { lines, reviews, files } = sinceLastReview(rows);
  if (lines <= MIN_LINES) return;
  if (!firstTime(d.session_id || "?", reviews)) return;
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `Review before "done": about ${lines} lines of code changed since the last review (${files.slice(0, 4).join(", ")}${files.length > 4 ? ", …" : ""}). ` +
      `Run the ${REVIEWER} subagent on the task diff (git diff or a commit range) with the acceptance criteria. ` +
      `Fix the high and medium findings and re-check them; the reviewer logs the rest in the findings journal itself. Then end the turn.`,
  }));
}

function lastText(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = rows[i].message || rows[i];
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    const t = m.content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
    if (t) return t;
  }
  return "";
}

function sinceLastReview(rows) {
  let lines = 0;
  let reviews = 0;
  const files = new Set();
  for (const row of rows) {
    const content = (row.message || row).content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type !== "tool_use") continue;
      if (/^(Agent|Task)$/.test(c.name) && agentIs(c.input?.subagent_type, REVIEWER)) { reviews += 1; lines = 0; files.clear(); continue; }
      if (!EDIT_TOOLS.has(c.name)) continue;
      const path = String(c.input?.file_path || "");
      if (!CODE_EXT.has(extname(path))) continue;
      const added = c.name === "Write" ? c.input.content : c.name === "MultiEdit" ? (c.input.edits || []).map((e) => e.new_string).join("\n") : c.input.new_string;
      lines += String(added || "").split("\n").length;
      files.add(path.split("/").pop());
    }
  }
  return { lines, reviews, files: [...files] };
}

function firstTime(session, reviews) {
  let state = {};
  try { state = JSON.parse(readFileSync(STATE, "utf8")) || {}; } catch { state = {}; }
  const key = `${session}:${reviews}`;
  if (state[key]) return false;
  state[key] = new Date().toISOString();
  const keep = Object.entries(state).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 500);
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(Object.fromEntries(keep)) + "\n");
  return true;
}
