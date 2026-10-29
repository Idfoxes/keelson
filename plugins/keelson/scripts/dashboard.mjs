#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { isMachineTurn, CORRECTION, RETRY, APP_QUIT, NUDGE } from "./lib/text.mjs";
import { tokensOf, trusted } from "./lib/ledger.mjs";
import { readAll, select, summarize } from "./lib/findings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = join(homedir(), ".agent");
const OUT = join(AGENT, "dashboard.html");
const DAYS = Number(process.argv.includes("--days") ? process.argv[process.argv.indexOf("--days") + 1] : 7);
const since = new Date(Date.now() - DAYS * 86400000).toISOString();

const raw = readJournal(true).filter((r) => r.ts >= since);
const rows = raw.filter((r) => !isMachineTurn(r.text));
const crashes = raw.filter((r) => APP_QUIT.test(String(r.text || "").trimStart())).length;
const denials = existsSync(join(AGENT, "denials.jsonl"))
  ? readLines(join(AGENT, "denials.jsonl")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && x.ts >= since).length
  : null;
const sessions = groupSessions(rows);
const nudges = rows.filter((r) => NUDGE.test(String(r.text || "")));
const turns = existsSync(join(AGENT, "turns.jsonl"))
  ? readLines(join(AGENT, "turns.jsonl")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && x.ts >= since)
  : null;
const CTX_STOP = 200000;
const heavy = turns ? new Set(turns.filter((t) => t.ctx >= CTX_STOP).map((t) => t.session)).size : null;
const beforeNudge = turns ? nudges.map((n) => turns.filter((t) => t.session === n.session && t.ts < n.ts).pop()).filter(Boolean).slice(-8).reverse() : [];
const long = [...sessions.values()].filter((s) => s.rows.length >= 30);
const longTurns = long.reduce((a, s) => a + s.rows.length, 0);
const clusters = cluster(rows).filter((c) => c.rows.length >= 4).slice(0, 10);
const fixes = corrections(sessions);
const ledger = latestLedger();
const spend = runJson(["context-ledger.mjs", "--cost", "--days", String(DAYS), "--json"]);
const lessons = readLines(join(AGENT, "lessons.jsonl")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  .sort((a, b) => b.confirmed - a.confirmed || b.shown - a.shown);
const FINDINGS_DAYS = 28;
const findings = select(readAll(), { days: FINDINGS_DAYS });
const findingsSum = summarize(findings);
const candidates = runJson(["learn.mjs", "suggest", "--json"]) || [];

mkdirSync(AGENT, { recursive: true });
writeFileSync(OUT, page(), "utf8");
console.log("Done: " + OUT);
if (!process.argv.includes("--no-open")) {
  try { execFileSync("open", [OUT], { stdio: "ignore" }); } catch { console.log("Open it manually: open " + OUT); }
}

function readJournal(keepMachine) {
  const dir = join(AGENT, "journal");
  const out = [];
  for (const f of listDir(dir).filter((x) => x.endsWith(".jsonl")).sort().slice(-2)) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (keepMachine || !isMachineTurn(r.text)) out.push(r);
      } catch { continue; }
    }
  }
  return out;
}

function groupSessions(list) {
  const map = new Map();
  for (const r of list) {
    const k = r.session || "-";
    if (!map.has(k)) map.set(k, { id: k, project: r.project || r.repo, rows: [] });
    map.get(k).rows.push(r);
  }
  for (const s of map.values()) s.rows.sort((a, b) => a.ts.localeCompare(b.ts));
  return map;
}

function cluster(list) {
  const out = [];
  for (const r of list) {
    const set = new Set((r.key || "").split(" ").filter(Boolean));
    if (!set.size) continue;
    const hit = out.find((c) => {
      let n = 0;
      for (const w of set) if (c.core.has(w)) n++;
      return n >= 2 && n / Math.min(c.core.size, set.size) >= 0.5;
    });
    if (hit) {
      hit.rows.push(r);
      for (const w of [...hit.core]) if (!set.has(w) && hit.rows.length > 2) hit.core.delete(w);
    } else out.push({ core: new Set(set), rows: [r] });
  }
  return out.sort((a, b) => b.rows.length - a.rows.length);
}

function corrections(map) {
  const out = [];
  for (const s of map.values()) {
    s.rows.forEach((r, i) => {
      if (CORRECTION.test(r.text) || RETRY.test(r.text)) out.push({ r, prev: i ? s.rows[i - 1] : null });
    });
  }
  return out.sort((a, b) => b.r.ts.localeCompare(a.r.ts));
}

function runJson(args) {
  try { return JSON.parse(execFileSync("node", [join(HERE, args[0]), ...args.slice(1)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
  catch { return null; }
}

function latestLedger() {
  const dir = join(AGENT, "context-ledger");
  const files = listDir(dir).filter((f) => f.endsWith(".jsonl"))
    .map((f) => [f, statSync(join(dir, f)).mtimeMs]).sort((a, b) => b[1] - a[1]);
  if (!files.length) return null;
  const items = readFileSync(join(dir, files[0][0]), "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).filter(trusted);
  const by = new Map();
  for (const it of items) {
    const k = it.tool + "  " + it.target;
    const e = by.get(k) || { tokens: 0, n: 0 };
    e.tokens += tokensOf(it); e.n++;
    by.set(k, e);
  }
  return { id: files[0][0].replace(/\.jsonl$/, ""), total: items.reduce((a, x) => a + tokensOf(x), 0), top: [...by].sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 8) };
}

function weeks(list) {
  const byWeek = new Map();
  for (const f of list.filter((x) => x.kind !== "scope")) {
    const d = new Date(f.ts);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = d.toISOString().slice(5, 10);
    byWeek.set(key, (byWeek.get(key) || 0) + 1);
  }
  return [...byWeek].sort().map(([label, value]) => ({ label: "week of " + label, value }));
}
function listDir(dir) { try { return readdirSync(dir); } catch { return []; } }
function readLines(file) { try { return readFileSync(file, "utf8").split("\n").map((s) => s.trim()).filter(Boolean); } catch { return []; } }
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
function short(s, n) { const t = String(s || "").replace(/\s+/g, " "); return t.length > n ? t.slice(0, n) + "…" : t; }

function bars(items, unit) {
  const max = Math.max(1, ...items.map((x) => x.value));
  return items.map((x) => `<div class="bar"><span class="lbl">${esc(x.label)}</span><span class="track"><span class="fill ${x.cls || ""}" style="width:${(x.value / max * 100).toFixed(1)}%"></span></span><span class="val">${esc(x.value)}${unit || ""}</span></div>`).join("");
}

function page() {
  const byDay = new Map();
  for (const r of rows) byDay.set(r.ts.slice(0, 10), (byDay.get(r.ts.slice(0, 10)) || 0) + 1);
  const days = [...byDay].sort().map(([d, n]) => ({ label: d.slice(5), value: n }));
  const top = [...sessions.values()].sort((a, b) => b.rows.length - a.rows.length).slice(0, 8)
    .map((s) => ({ label: short(s.project, 34), value: s.rows.length, cls: s.rows.length >= 30 ? "hot" : "" }));
  const share = rows.length ? Math.round(longTurns / rows.length * 100) : 0;

  const clusterHtml = clusters.map((c) => {
    const repos = new Set(c.rows.map((r) => r.project || r.repo)).size;
    return `<tr><td class="num">×${c.rows.length}</td><td>${esc(short(c.rows[c.rows.length - 1].text, 110))}</td><td class="num">${repos}</td></tr>`;
  }).join("");

  const fixHtml = fixes.slice(0, 12).map(({ r, prev }) => `<li><div class="meta">${esc(r.ts.slice(5, 16).replace("T", " "))} · ${esc(short(r.project || r.repo, 30))}</div>${prev ? `<div class="prev">before: ${esc(short(prev.text, 130))}</div>` : ""}<div class="fix">${esc(short(r.text, 160))}</div></li>`).join("");


  const ledgerHtml = ledger ? bars(ledger.top.map(([k, e]) => ({ label: short(k, 48), value: e.tokens })), "") : `<p class="muted">The ledger is empty so far.</p>`;

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Keelson: weekly report</title><style>
:root{--bg:#fafaf9;--card:#fff;--ink:#1c1917;--muted:#78716c;--line:#e7e5e4;--accent:#2563eb;--hot:#dc2626;--ok:#16a34a}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--card:#1c1917;--ink:#f5f5f4;--muted:#a8a29e;--line:#292524;--accent:#60a5fa;--hot:#f87171;--ok:#4ade80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:0 0 12px}.muted,.meta{color:var(--muted)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}.kpi b{display:block;font-size:26px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:14px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;overflow:hidden}
.bar{display:grid;grid-template-columns:minmax(90px,38%) 1fr 56px;gap:8px;align-items:center;margin:5px 0}
.lbl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.track{height:10px;background:var(--line);border-radius:5px;overflow:hidden}
.fill{display:block;height:100%;background:var(--accent)}.fill.hot{background:var(--hot)}.val{text-align:right;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse}td{padding:6px 4px;border-top:1px solid var(--line);vertical-align:top}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
tr.cold td{color:var(--muted)}ul{list-style:none;margin:0;padding:0}li{padding:8px 0;border-top:1px solid var(--line)}
.prev{color:var(--muted)}.fix{margin-top:2px}.tags span{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:2px 10px;margin:3px 4px 0 0}
@media (max-width:560px){.grid{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Keelson: last ${DAYS} days</h1>
<div class="muted">Built ${esc(new Date().toISOString().slice(0, 16).replace("T", " "))} UTC from ~/.agent. Claude Code only: Cowork, chat and Codex do not report here.</div>
<div class="kpis">
<div class="kpi"><b>${rows.length}</b>requests</div>
<div class="kpi"><b>${sessions.size}</b>sessions</div>
<div class="kpi"><b style="color:${share >= 40 ? "var(--hot)" : "var(--ok)"}">${share}%</b>of turns are in sessions longer than 30 turns</div>
<div class="kpi"><b>${fixes.length}</b>corrections and retries</div>
<div class="kpi"><b style="color:${crashes ? "var(--hot)" : "var(--ok)"}">${crashes}</b>app crashes mid-task</div>
<div class="kpi"><b style="color:${denials ? "var(--hot)" : "var(--ok)"}">${denials === null ? "—" : denials}</b>tool-call denials by the permission classifier</div>
<div class="kpi"><b>${spend && spend.sessions.length ? "~$" + Math.round(spend.totalUsd) : "—"}</b>spent resending context on tool calls</div>
<div class="kpi"><b style="color:${nudges.length ? "var(--hot)" : "var(--ok)"}">${nudges.length}</b>times I had to write "continue"</div>
<div class="kpi"><b style="color:${heavy ? "var(--hot)" : "var(--ok)"}">${heavy === null ? "—" : heavy}</b>sessions went past 200k of context</div>
</div>
<div class="grid">
<section><h2>Requests per day</h2>${bars(days, "")}</section>
<section><h2>Longest sessions</h2>${bars(top, "")}<p class="muted">Red: longer than 30 turns. Session cost grows as turns × average context, which is quadratic.</p></section>
<section><h2>What gets asked again and again</h2><table>${clusterHtml || "<tr><td class=muted>No request repeated four or more times.</td></tr>"}</table><p class="muted">Candidates to move into a script or skill. Right column: number of repositories.</p></section>
<section><h2>Lessons from corrections</h2>${lessons.length ? `<table><tr><td class="muted">lesson</td><td class="muted">where</td><td class="num muted">corrections</td><td class="num muted">shown</td></tr>${lessons.slice(0, 8).map((l) => `<tr><td>${esc(short(l.lesson, 110))}</td><td>${esc(l.project === "*" ? "all" : l.project)}</td><td class="num">${l.confirmed}</td><td class="num">${l.shown}</td></tr>`).join("")}</table>` : `<p class="muted">No lessons yet.</p>`}<p class="muted">The agent records a lesson when you correct it, and a hook adds it to similar requests. Three corrections or more: a candidate for a permanent rule, which the weekly review proposes.</p></section>
<section><h2>Review and gate findings over ${FINDINGS_DAYS} days</h2>${findingsSum.total ? `<p>${findingsSum.total} findings, high ${findingsSum.bySeverity.high || 0}${findingsSum.perKLines === null ? "" : `, per 1000 lines ${findingsSum.perKLines.toFixed(1)}`}</p>${bars(weeks(findings), "")}${bars(Object.entries(findingsSum.byClass).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ label: k, value: v })), "")}${candidates.length ? `<p>Rule candidates: ${candidates.slice(0, 4).map((c) => esc(`${c.repo} ${c.class} ×${c.count}`)).join(", ")}</p>` : ""}` : `<p class="muted">No findings yet: the reviewer, the quality gate and findings.mjs add write them.</p>`}<p class="muted">Target: the terms, contract and raw-value classes per 1000 lines halve within 4 weeks. A class that repeats three times becomes a rule in the review.</p></section>
<section><h2>Most expensive sessions</h2>${spend && spend.sessions.length ? `<table><tr><td class="muted">session</td><td class="muted">repository</td><td class="num muted">calls</td><td class="num muted">context</td><td class="num muted">≈ $</td></tr>${spend.sessions.slice(0, 8).map((e) => `<tr><td>${esc(e.id)}</td><td>${esc(e.project)}</td><td class="num">${e.calls}</td><td class="num">${Math.round(e.ctxSum / e.calls / 1000)}k</td><td class="num">${e.usd.toFixed(2)}</td></tr>`).join("")}</table>` : `<p class="muted">No measurements yet: context size per call is recorded as you work.</p>`}<p class="muted">Every tool call resends the whole context. The cost here is calls × context at the Opus 5.5 cache-read price, $0.40 per million: the main expense, while the model's own output is negligible by comparison.</p></section>
<section><h2>How the turn ended before "continue"</h2>${turns === null ? `<p class="muted">The turn-log hook has not run yet.</p>` : `<ul>${beforeNudge.map((t) => `<li><span class="muted">${esc(t.ts.slice(5, 16).replace("T", " "))} ${esc(t.project)} ${Math.round((t.ctx || 0) / 1000)}k</span> …${esc(t.tail.slice(-140))}</li>`).join("") || "<li class=muted>No nudges since the hook was connected.</li>"}</ul>`}<p class="muted">Every "continue" is one more turn that resends the whole context. This shows where the agent stopped on its own.</p></section>
<section><h2>Corrections and retries</h2><ul>${fixHtml || "<li class=muted>No corrections.</li>"}</ul></section>
<section><h2>What added tokens in the latest session</h2>${ledger ? `<p class="muted">Session ${esc(ledger.id)}, ~${ledger.total} tokens in total.</p>` : ""}${ledgerHtml}${ledger && ledger.top.length && ledger.top[0][1].tokens > ledger.total * 0.3 && ledger.top[0][1].tokens > 20000 ? `<p style="color:var(--hot)">One call added ${Math.round(ledger.top[0][1].tokens / ledger.total * 100)}% of the session. Read large files and logs with tail, grep or a line range, not whole.</p>` : ""}</section>
</div></main></body></html>`;
}
