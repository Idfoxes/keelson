#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { CHARS_PER_TOKEN, callCostUsd, seenChars, tokensOf, trusted } from "./lib/ledger.mjs";
import { lastTurn } from "./lib/transcript.mjs";
import { family } from "./lib/prices.mjs";
import { redact } from "./lib/redact.mjs";
import { STOP_TOKENS, COMPACT_NOTE, continuation, remember, signaled } from "./lib/guard-state.mjs";

const SUBAGENT_STOP = Number(process.env.AGENT_CTX_SUBAGENT_STOP_TOKENS || 200000);

const LOOP_REPEATS = 5;
const KEEP_HEX = ["hexblob"];
const DIR = join(homedir(), ".agent", "context-ledger");
const argv = process.argv.slice(2);

const LIGHT = /^(Read|Grep|Glob|LS) |^Bash (ls|cat|head|tail|wc|grep|rg|find|git (status|log|diff|show)|kubectl (get|describe|logs))\b/;

if (argv.includes("--cost")) {
  const i = argv.indexOf("--days");
  cost(i >= 0 ? Number(argv[i + 1]) : 7);
  process.exit(0);
}

if (argv.includes("--report")) {
  report(argv[argv.indexOf("--report") + 1]);
  process.exit(0);
}

try {
  record();
} catch {
  process.exit(0);
}
process.exit(0);

function record() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  const session = (d.session_id || "").slice(0, 8);
  if (!session) return;

  const tool = d.tool_name || "?";
  const size = seenChars(tool, d.tool_input, d.tool_response);
  if (!size) return;

  const agent = d.agent_id ? String(d.agent_type || "subagent").slice(0, 40) : "";
  const turn = agent ? subagentTurn(d.transcript_path, d.agent_id) : lastTurn(d.transcript_path);
  const ctx = turn.ctx;
  const row = {
    ts: new Date().toISOString(),
    tool,
    target: target(tool, d.tool_input || {}),
    tokens: Math.round(size / CHARS_PER_TOKEN),
    ctx,
    v: 3,
  };
  if (agent) { row.agent = agent; row.aid = String(d.agent_id).slice(0, 40); }
  if (turn.id) row.mid = turn.id;
  if (family(turn.model)) row.model = family(turn.model);
  mkdirSync(DIR, { recursive: true });
  appendFileSync(join(DIR, session + ".jsonl"), JSON.stringify(row) + "\n", "utf8");

  const full = String(d.session_id || "");
  if (agent) {
    const key = `${full}:${d.agent_id}`;
    if (ctx < SUBAGENT_STOP || !full || signaled(key)) return;
    remember(key, ctx, "subagent");
    say(`Subagent context is ${Math.round(ctx / 1000)}k, over the ${Math.round(SUBAGENT_STOP / 1000)}k limit: every next call resends all of it. ` +
      `Do not start a new step. Finish the current one to a verified result and end with a summary: what is done, how it was checked, what is left. The main agent will hand the rest to a fresh subagent.`);
    return;
  }
  const loop = loopWarning(session, row);
  if (ctx < STOP_TOKENS || !full || signaled(full)) {
    if (loop) say(loop);
    return;
  }
  remember(full, ctx, "tool");
  say((loop ? loop + " " : "") + `Session context is ${Math.round(ctx / 1000)}k mid-task, ${COMPACT_NOTE}, over the ${Math.round(STOP_TOKENS / 1000)}k limit: every next call resends all of it. ` +
        `Do not start a new step here. Finish the current one to a verified commit; if you are waiting on subagents, wait for their results. ` + continuation(full));
}

function say(text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }));
}

function loopWarning(session, row) {
  const rows = readFileSync(join(DIR, session + ".jsonl"), "utf8").trim().split("\n").slice(-LOOP_REPEATS)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } });
  if (rows.length < LOOP_REPEATS || !rows.every((r) => r && !r.agent && r.tool === row.tool && r.target === row.target)) return "";
  const file = join(homedir(), ".agent", "loop-warned.json");
  let warned = {};
  try { warned = JSON.parse(readFileSync(file, "utf8")) || {}; } catch { warned = {}; }
  const key = session + " " + row.tool + " " + row.target;
  if (warned[key]) return "";
  warned[key] = new Date().toISOString();
  writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(warned).slice(-500))) + "\n", "utf8");
  return `${LOOP_REPEATS} identical calls in a row (${row.tool} ${row.target}): this looks like a loop. ` +
    `Do not repeat it until you understand why the result does not change; wait for background work by notification, not by polling.`;
}

function subagentTurn(transcript, id) {
  if (!transcript) return { ctx: 0, id: "", model: "" };
  const file = join(dirname(transcript), basename(transcript, ".jsonl"), "subagents", `agent-${id}.jsonl`);
  if (!existsSync(file)) return { ctx: 0, id: "", model: "" };
  const t = lastTurn(file);
  return { ctx: t.ctx, id: "", model: t.model };
}

function target(tool, input) {
  if (tool === "Skill" && input.skill) return String(input.skill).slice(0, 60);
  if (input.file_path) return String(input.file_path);
  if (input.notebook_path) return String(input.notebook_path);
  if (input.pattern) return String(input.pattern).slice(0, 60) + (input.path ? " in " + input.path : "");
  if (input.command) return redact(String(input.command), KEEP_HEX).text.slice(0, 60);
  if (input.url) return redact(String(input.url), KEEP_HEX).text.slice(0, 60);
  if (input.prompt) return "subagent: " + redact(String(input.prompt), KEEP_HEX).text.slice(0, 50);
  return tool;
}

function report(which) {
  let files = [];
  try { files = readdirSync(DIR).filter((f) => f.endsWith(".jsonl")); } catch { files = []; }
  if (!files.length) {
    console.log("The ledger is empty: " + DIR + ". The hook has not run yet.");
    return;
  }
  let file;
  if (which && which !== "--last" && !which.startsWith("--")) file = which.endsWith(".jsonl") ? which : which + ".jsonl";
  else file = files.map((f) => [f, statSync(join(DIR, f)).mtimeMs]).sort((a, b) => b[1] - a[1])[0][0];
  if (!files.includes(file)) {
    const near = files.find((f) => f.startsWith(file.replace(/\.jsonl$/, "").slice(0, 8)));
    if (!near) { console.log("No such session: " + file + ". Available: " + files.map((f) => f.replace(/\.jsonl$/, "")).join(", ")); return; }
    file = near;
  }

  const rows = readFileSync(join(DIR, file), "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).filter(trusted);
  if (!rows.length) { console.log("No entries."); return; }

  const total = rows.reduce((a, r) => a + tokensOf(r), 0);
  console.log(`Session ${file.replace(/\.jsonl$/, "")}: ${rows.length} calls, ~${total} tokens added to context.`);
  console.log("");

  const byTarget = new Map();
  for (const r of rows) {
    const key = r.tool + "  " + r.target;
    const e = byTarget.get(key) || { tokens: 0, n: 0 };
    e.tokens += tokensOf(r); e.n++;
    byTarget.set(key, e);
  }
  const top = [...byTarget.entries()].sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 15);
  console.log("what added the most:");
  for (const [key, e] of top) {
    const share = Math.round(e.tokens / total * 100);
    console.log(`  ${String(e.tokens).padStart(7)} tok  ${String(share).padStart(2)}%  ×${String(e.n).padEnd(3)} ${key}`);
  }
  console.log("");

  const repeats = [...byTarget.entries()].filter(([k, e]) => e.n >= 3 && /^(Read|NotebookRead)/.test(k))
    .sort((a, b) => b[1].n - a[1].n);
  if (repeats.length) {
    console.log("read three or more times, once would have done:");
    let waste = 0;
    for (const [key, e] of repeats) {
      const extra = Math.round(e.tokens * (e.n - 1) / e.n);
      waste += extra;
      console.log(`  ×${String(e.n).padEnd(3)} extra ~${String(extra).padStart(6)} tok  ${key}`);
    }
    console.log(`  about ${waste} tokens wasted, that is ${Math.round(waste / total * 100)}% of the session`);
  } else {
    console.log("no repeated reads of the same file.");
  }
}

function cost(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const projects = sessionProjects();
  const sessions = new Map();
  let sub = 0;
  let blind = 0;
  const lastKey = new Map();
  const byModel = new Map();
  const light = { calls: 0, usd: 0 };
  let files = [];
  try { files = readdirSync(DIR).filter((f) => f.endsWith(".jsonl")); } catch { files = []; }
  for (const f of files) {
    const id = f.replace(/\.jsonl$/, "");
    for (const l of readFileSync(join(DIR, f), "utf8").split("\n")) {
      if (!l.trim()) continue;
      let r;
      try { r = JSON.parse(l); } catch { continue; }
      if (r.ts < since) continue;
      if (!r.ctx) { if (r.agent) blind++; continue; }
      if (r.agent) sub++;
      const same = r.mid ? `m:${r.mid}` : `c:${r.agent || ""}:${r.ctx}`;
      if (lastKey.get(id) === same) continue;
      lastKey.set(id, same);
      const e = sessions.get(id) || { id, calls: 0, usd: 0, ctxSum: 0, project: projects.get(id) || "-" };
      const usd = callCostUsd(r);
      e.calls++; e.usd += usd; e.ctxSum += r.ctx;
      sessions.set(id, e);
      const fam = r.model || "?";
      const m = byModel.get(fam) || { calls: 0, usd: 0 };
      m.calls++; m.usd += usd;
      byModel.set(fam, m);
      if (fam !== "haiku" && fam !== "sonnet" && LIGHT.test(`${r.tool} ${r.target || ""}`)) { light.calls++; light.usd += usd; }
    }
  }
  const list = [...sessions.values()].sort((a, b) => b.usd - a.usd);
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ days, totalUsd: list.reduce((a, e) => a + e.usd, 0), subagentCalls: sub, subagentBlind: blind, byModel: Object.fromEntries(byModel), light, sessions: list.slice(0, 10) }));
    return;
  }
  if (!list.length) { console.log("No context measurements in the ledger yet: the ctx field fills in as you work."); return; }
  const total = list.reduce((a, e) => a + e.usd, 0);
  console.log(`Last ${days} days, context resent on tool calls: ~${total.toFixed(2)} at the cache-read price, ${list.length} sessions.`);
  if (sub || blind) console.log(`Of these, ${sub} are subagent calls, priced by their own context; another ${blind} subagent calls without a context measurement are not included in the price.`);
  console.log("By model: " + [...byModel].sort((x, y) => y[1].usd - x[1].usd).map(([f, m]) => `${f === "?" ? "no model (priced as Opus)" : f} ~$${m.usd.toFixed(2)}, ${m.calls} calls`).join("; "));
  if (light.calls) console.log(`Reading and search on the expensive model: ~$${light.usd.toFixed(2)} (${Math.round(light.usd * 100 / total)} %), ${light.calls} calls. Candidate for a Haiku subagent.`);
  console.log("");
  for (const e of list.slice(0, 10)) {
    console.log(`  ~$${e.usd.toFixed(2).padStart(6)}  ${e.id}  ${e.project.padEnd(24)} calls ${String(e.calls).padStart(4)}, average context ${Math.round(e.ctxSum / e.calls / 1000)}k`);
  }
}

function sessionProjects() {
  const map = new Map();
  let raw = "";
  try { raw = readFileSync(join(homedir(), ".agent", "turns.jsonl"), "utf8"); } catch { return map; }
  for (const l of raw.split("\n")) {
    if (!l.trim()) continue;
    try { const t = JSON.parse(l); if (t.session && t.project) map.set(t.session, t.project); } catch { continue; }
  }
  return map;
}
