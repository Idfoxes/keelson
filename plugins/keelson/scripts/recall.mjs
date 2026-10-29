#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { ADR_DIRS } from "./lib/agent-dir.mjs";
import { gitTop } from "./lib/checks.mjs";
import { isMachineTurn } from "./lib/text.mjs";

const AGENT = process.env.KEELSON_AGENT_DIR || join(homedir(), ".agent");
const SNIPPET = 220;
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i < 0 || argv[i + 1] === undefined ? d : argv[i + 1]; };
const query = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--"))).join(" ");
if (!query) {
  console.log('recall.mjs "what to find" [--repo R] [--limit 8]   search the request journal, handoffs, findings, lessons, task logs and ADRs');
  process.exit(0);
}

const tokens = (s) => (String(s || "").toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) || []).map((w) => w.slice(0, 6));
const docs = [...journal(), ...handoffs(), ...jsonl("findings.jsonl", (r) => r.kind !== "scope" && `${r.class} ${r.file || ""} ${r.evidence || ""}`, "finding"),
  ...jsonl("lessons.jsonl", (r) => `${r.lesson} ${Array.isArray(r.when) ? r.when.join("; ") : r.when || ""}`, "lesson"), ...tasks(), ...adrs()]
  .filter((d) => d.text && (!opt("repo") || d.repo === opt("repo")));
const q = [...new Set(tokens(query))];
const df = new Map(q.map((t) => [t, docs.filter((d) => d.tokens.has(t)).length]));
const need = Math.max(1, Math.ceil(q.length / 2));
const scored = docs.map((d) => ({ d, hits: q.filter((t) => d.tokens.has(t)).length, score: q.reduce((a, t) => a + (d.tokens.has(t) ? Math.log(1 + docs.length / (1 + df.get(t))) : 0), 0) }))
  .filter((x) => x.hits >= need).sort((a, b) => b.score - a.score || String(b.d.ts).localeCompare(String(a.d.ts))).slice(0, Number(opt("limit", 8)));
if (!scored.length) console.log("Nothing similar found.");
for (const { d } of scored) console.log(`${String(d.ts || "").slice(0, 10)} ${d.kind} ${d.repo || ""}: ${d.text.replace(/\s+/g, " ").slice(0, SNIPPET)}`);

function doc(kind, text, ts, repo) {
  return { kind, text: String(text || ""), ts, repo, tokens: new Set(tokens(text)) };
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

function journal() {
  const dir = join(AGENT, "journal");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readJsonl(join(dir, f)))
    .filter((r) => !isMachineTurn(r.text) && String(r.text || "").length >= 40).map((r) => doc("request", r.text, r.ts, r.repo));
}

function handoffs() {
  const dir = join(AGENT, "handoff");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => doc("handoff", readFileSync(join(dir, f), "utf8"), new Date(statSync(join(dir, f)).mtimeMs).toISOString(), basename(f, ".md")));
}

function jsonl(name, text, kind) {
  return readJsonl(join(AGENT, name)).map((r) => doc(kind, text(r), r.ts, r.repo || r.project));
}

function tasks() {
  const dir = join(AGENT, "tasks");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readJsonl(join(dir, f)).map((r) => doc("task log", `${r.kind}: ${r.text}`, r.ts, basename(f, ".jsonl"))));
}

function adrs() {
  const root = gitTop(process.cwd());
  if (!root) return [];
  return ADR_DIRS.map((d) => join(root, d)).filter(existsSync).flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith(".md"))
    .map((f) => doc("ADR", readFileSync(join(dir, f), "utf8").slice(0, 4000), new Date(statSync(join(dir, f)).mtimeMs).toISOString(), basename(root))));
}
