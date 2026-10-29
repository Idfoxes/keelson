import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { canonical } from "./paths.mjs";
import { redact } from "./redact.mjs";

export const CLASSES = ["terms", "contract", "lint", "types", "tests", "claim", "single-source", "raw-value", "ui-state", "layout", "security", "test-gap", "duplicate", "dead-code", "junk", "perf", "other"];
export const SEVERITIES = ["high", "medium", "low"];
export const SOURCES = ["review", "gate", "user", "colleague"];
export const MAX_EVIDENCE = 300;

export function findingsFile() {
  return join(homedir(), ".agent", "findings.jsonl");
}

export function validate(row) {
  if (!row || typeof row !== "object") return "row is not an object";
  if (!row.repo) return "missing repo";
  if (row.kind === "scope") return Number(row.lines) > 0 ? null : "scope has no lines";
  if (!CLASSES.includes(row.class)) return `class "${row.class}" is not in the list: ${CLASSES.join(", ")}`;
  if (!SEVERITIES.includes(row.severity)) return `severity "${row.severity}" is not in the list: ${SEVERITIES.join(", ")}`;
  if (!SOURCES.includes(row.source)) return `source "${row.source}" is not in the list: ${SOURCES.join(", ")}`;
  return null;
}

export function normalize(raw) {
  const row = { ts: raw.ts || new Date().toISOString(), ...raw };
  for (const key of ["evidence", "file", "rule", "task"]) {
    if (row[key] === undefined || row[key] === null || row[key] === "") { delete row[key]; continue; }
    row[key] = redact(String(row[key])).text.slice(0, MAX_EVIDENCE);
  }
  if (row.root) row.root = canonical(String(row.root));
  else delete row.root;
  row.id = row.id || createHash("sha1").update([row.repo, row.kind || "finding", row.class, row.file, row.evidence, row.lines, row.ts.slice(0, 10)].join("|")).digest("hex").slice(0, 12);
  return row;
}

export function readAll(file = findingsFile()) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

export function record(rows, file = findingsFile()) {
  const known = new Set(readAll(file).map((r) => r.id));
  const added = [];
  const rejected = [];
  for (const raw of rows) {
    const error = validate(raw);
    if (error) { rejected.push(error); continue; }
    const row = normalize(raw);
    if (known.has(row.id)) continue;
    known.add(row.id);
    added.push(row);
  }
  if (added.length) {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, added.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  return { added: added.length, rejected };
}

export function select(rows, { repo, days, source } = {}) {
  const since = days ? Date.now() - Number(days) * 86400000 : 0;
  return rows.filter((r) => (!repo || r.repo === repo) && (!source || r.source === source) && Date.parse(r.ts) >= since);
}

export function summarize(rows) {
  const findings = rows.filter((r) => r.kind !== "scope");
  const lines = rows.filter((r) => r.kind === "scope").reduce((s, r) => s + Number(r.lines), 0);
  const byClass = {};
  const bySeverity = {};
  for (const f of findings) {
    byClass[f.class] = (byClass[f.class] || 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }
  return { total: findings.length, lines, perKLines: lines ? (findings.length * 1000) / lines : null, byClass, bySeverity };
}
