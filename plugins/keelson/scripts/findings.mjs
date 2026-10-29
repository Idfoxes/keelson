#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { actedOn, actedSummary, blobOf, fileOf, ledgerEdits } from "./lib/acted.mjs";
import { CLASSES, readAll, record, select, summarize } from "./lib/findings.mjs";
import { gitTop } from "./lib/checks.mjs";
import { repoKey } from "./lib/repo.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i < 0 || argv[i + 1] === undefined ? d : argv[i + 1]; };
const commands = { add, import: importFile, scope, stats, classes, acted };
const run = commands[argv[0]];
if (!run) {
  console.log("findings.mjs add --class C [--severity medium] [--source review] [--file f] [--evidence text] [--rule r] [--task t] [--repo R]\n" +
    "findings.mjs import <file.jsonl> | scope --lines N [--repo R] | stats [--repo R] [--days N] [--source S] [--json] | classes | acted [--days 14] [--source review]");
  process.exit(argv[0] ? 2 : 0);
}
process.exit(run() || 0);

function add() {
  const root = opt("root", gitTop(process.cwd()) || undefined);
  const row = {
    repo: opt("repo", repoKey(process.cwd())), source: opt("source", "review"), class: opt("class"), severity: opt("severity", "medium"),
    file: opt("file"), evidence: opt("evidence"), rule: opt("rule"), task: opt("task"), root,
  };
  const file = fileOf(row);
  const path = !file ? "" : isAbsolute(file) ? file : root ? join(root, file) : "";
  const blob = path && existsSync(path) ? blobOf(path) : "";
  return report(record([blob ? { ...row, blob } : row]));
}

function importFile() {
  const rows = readFileSync(argv[1], "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  });
  return report(record(rows));
}

function scope() {
  return report(record([{ kind: "scope", repo: opt("repo", repoKey(process.cwd())), source: opt("source", "review"), lines: Number(opt("lines", 0)) }]));
}

function stats() {
  const s = summarize(select(readAll(), { repo: opt("repo"), days: opt("days"), source: opt("source") }));
  if (argv.includes("--json")) { console.log(JSON.stringify(s)); return 0; }
  const high = s.bySeverity.high || 0;
  console.log(`Findings: ${s.total}, high ${high}` + (s.perKLines === null ? "" : `, per 1000 lines ${s.perKLines.toFixed(1)}`));
  for (const [cls, n] of Object.entries(s.byClass).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cls.padEnd(14)} ${String(n).padStart(4)}  ${Math.round((n * 100) / s.total)} %`);
  }
  return 0;
}

function classes() {
  console.log(CLASSES.join("\n"));
  return 0;
}

function report({ added, rejected }) {
  console.log(`Recorded ${added}` + (rejected.length ? `, rejected ${rejected.length}: ${[...new Set(rejected)].join("; ")}` : ""));
  return rejected.length && !added ? 1 : 0;
}

function acted() {
  const days = Number(opt("days", 14));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const source = opt("source", "review");
  const rows = actedOn(readAll().filter((f) => f.kind !== "scope" && f.source === source && f.ts >= since), ledgerEdits(since));
  const exact = actedSummary(rows.filter((r) => r.blob));
  const legacy = actedSummary(rows.filter((r) => !r.blob));
  const pct = (x) => `${Math.round(x * 100)} %`;
  if (!exact.known && !legacy.known) { console.log(`No ${source} comments with a file in the last ${days} days.`); return 0; }
  if (legacy.known) console.log(`Without a file fingerprint (${legacy.known}): the log sees an edit to the same file for ${pct(legacy.share)}, for high and medium ${legacy.serious ? pct(legacy.seriousShare) : "-"}. This is a lower bound: the log cannot tell edits made through Bash.`);
  if (!exact.known) { console.log("No comments with a file fingerprint yet: findings.mjs add writes it. A conclusion needs 20 serious comments that have one."); return 0; }
  console.log(`With a file fingerprint (${exact.known}): the file changed after the comment for ${pct(exact.share)}, for high and medium ${exact.serious ? pct(exact.seriousShare) : "-"} (an edit in the log within 6 h, or different content in a commit or on disk within 48 h).`);
  for (const [name, c] of exact.byClass) console.log(`  ${name.padEnd(14)} ${String(c.n).padStart(4)}  changed ${Math.round(c.acted * 100 / c.n)} %`);
  if (exact.serious < 20) { console.log(`No conclusion: ${exact.serious} serious comments with a fingerprint, 20 needed.`); return 0; }
  if (exact.seriousShare < 0.5) console.log(`Fewer than half of the serious comments lead to an edit.${exact.weakClasses.length ? ` Classes below 30 % with 5 or more comments: ${exact.weakClasses.join(", ")}. Consider removing them from the reviewer or raising their confidence threshold.` : ""}`);
  else console.log(`The reviewer pays off: more than half of the serious comments lead to an edit.${exact.weakClasses.length ? ` Weak classes: ${exact.weakClasses.join(", ")}.` : ""}`);
  return 0;
}
