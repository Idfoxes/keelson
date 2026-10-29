import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RULES, redact } from "./redact.mjs";
import { sessionKey } from "./codex.mjs";

export const BOARD_DIR = join(homedir(), ".agent", "board");
export const GUARD_FILE = join(homedir(), ".agent", "context-guard.json");
export const STATES = ["needs you", "waiting", "working", "done", "handed off"];
export const KEEP_MS = 14 * 86400000;

const LINE_CHARS = 200;
const WHAT_CHARS = 120;
const TAIL_CHARS = 300;
const MAX_LINKS = 5;
const WAIT = /(?<![\p{L}])(?:жду|waiting\s+for|waiting\s+on)\s+(.+?)\s*,?\s+(?:(?:примерно|about|around)\s+)?(?:до|until|till)\s+(?:(?:about|around)\s+)?((?:[01]?\d|2[0-3]):[0-5]\d)(?!\d)/iu;
const NEEDS = /(?<![\p{L}])(?:нужн[оа]?\s+тво[её]\s+решени[ея]|needs\s+you|need\s+your\s+(?:decision|input|confirmation)|please\s+(?:confirm|choose|decide)(?![\p{L}])|(?:подтверди|подтвердите|выбери|выберите|реши|решите)(?![\p{L}]))/iu;
const DONE = /^[\s*#>_\-`]*(?:(?:Готово|Сделано|Задача закрыта|Done|Finished|Completed|Task closed)(?![\p{L}])|(?:Итог|Summary|Result)\**\s*:)/iu;
const TRAILING_MARKUP = /[\s*_`»"')\]]+$/;
const TICKET = /\b[A-Z][A-Z0-9]+-\d+\b/;
const NOT_TICKET = /^(?:UTF|SHA|MD|ISO|HTTP|TLS|SSL|AES|RSA|RFC|CVE|PEP|IPV|GPT|UTC|GMT|FIX|BUGFIX|HOTFIX|RELEASE|FEATURE|FEAT|V)-/;
const WORKING_LINK = /merge_requests|\/commit\/|\/pull\//;
const URL_RE = /https?:\/\/[^\s<>"'`\])}»]+/g;
const SENTENCE_END = /(?<=[.!?…])\s+(?=[\p{Lu}\d«"“(\[])/u;
const PEM_RULES = RULES.filter((r) => r[2] === "pem");
const TOKEN_SOURCE = RULES.find((r) => r[2] === "token")[0].source;

export function redactText(text) {
  let t = String(text || "");
  for (const [re, repl] of PEM_RULES) t = t.replace(re, repl);
  return t.split("\n").map((l) => redact(l).text).join("\n");
}

export function classify(clean) {
  const lines = String(clean).split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = WAIT.exec(lines[i]);
    if (!m) continue;
    const what = m[1].replace(/[,;:\s]+$/, "").trim().slice(0, WHAT_CHARS);
    return { state: "waiting", what, until: m[2].padStart(5, "0") };
  }
  const tail = String(clean).trim().slice(-TAIL_CHARS);
  if (tail.replace(TRAILING_MARKUP, "").endsWith("?") || NEEDS.test(tail)) return { state: "needs you", what: "", until: "" };
  if (lines.some((l) => DONE.test(l))) return { state: "done", what: "", until: "" };
  return { state: "working", what: "", until: "" };
}

function firstTicket(source, flags) {
  for (const m of String(source || "").matchAll(new RegExp(TICKET.source, flags))) {
    const t = m[0].toUpperCase();
    if (!NOT_TICKET.test(t)) return t;
  }
  return "";
}

export function ticketOf(branch, text) {
  return firstTicket(branch, "gi") || firstTicket(text, "g");
}

export function linksOf(text) {
  const out = [];
  for (const m of String(text || "").matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, "").replace(/^(https?:\/\/)[^/\s@]*@/, "$1").replace(/[?#].*$/, "");
    if (!WORKING_LINK.test(url) || new RegExp(TOKEN_SOURCE).test(url) || out.includes(url)) continue;
    out.push(url);
    if (out.length === MAX_LINKS) break;
  }
  return out;
}

export function lastSentence(clean) {
  const prose = String(clean || "").replace(/```[\s\S]*?```/g, "\n").replace(/```[\s\S]*$/, "");
  const lines = prose.split("\n")
    .map((l) => l.replace(/^[\s#>*•\-]+|^\d+[.)]\s+/, "").replace(/^[*_`]+|[*_`]+$/g, "").trim())
    .filter(Boolean);
  const sentences = (lines[lines.length - 1] || "").split(SENTENCE_END).map((s) => s.trim()).filter(Boolean);
  const last = sentences[sentences.length - 1] || "";
  return last.length > LINE_CHARS ? last.slice(0, LINE_CHARS - 1) + "…" : last;
}

export function retiredIn(state, ids) {
  const wanted = new Set(ids.filter(Boolean).flatMap((i) => [String(i), sessionKey(i)]));
  const flagged = (v) => Boolean(v) && v !== "false";
  const keys = [];
  const all = state && typeof state === "object" ? state : {};
  for (const [k, v] of Object.entries(all)) {
    if (k !== "retired" && v && typeof v === "object" && flagged(v.retired)) keys.push(k);
  }
  const top = all.retired;
  if (Array.isArray(top)) keys.push(...top.map(String));
  else if (top && typeof top === "object") keys.push(...Object.entries(top).filter(([, v]) => flagged(v)).map(([k]) => k));
  else if (typeof top === "string" && top) keys.push(top);
  return keys.some((k) => wanted.has(k) || wanted.has(sessionKey(k)));
}

function guardState() {
  try { return JSON.parse(readFileSync(GUARD_FILE, "utf8")) || {}; } catch { return null; }
}

export function isRetired(ids) {
  const state = guardState();
  return state ? retiredIn(state, ids) : false;
}

export function applyRetired(entries) {
  const state = guardState();
  if (!state) return entries;
  return entries.map((e) => (retiredIn(state, [e.session]) ? { ...e, state: "handed off", until: "", what: "" } : e));
}

export function currentBranch(cwd) {
  if (!cwd) return "";
  try {
    const name = execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
    return name === "HEAD" ? "" : name;
  } catch {
    return "";
  }
}

export function buildEntry({ session, project, branch, ticketBefore = "", text, ctx, retired = false, now = new Date() }) {
  const clean = redactText(text);
  const verdict = classify(clean);
  return {
    session,
    project,
    branch,
    ticket: ticketOf(branch, clean) || ticketBefore,
    state: retired ? "handed off" : verdict.state,
    until: retired ? "" : verdict.until,
    what: retired ? "" : verdict.what,
    line: lastSentence(clean),
    links: linksOf(text),
    ctx,
    updated: now.toISOString(),
  };
}

function fileName(session) {
  return String(session).replace(/[^A-Za-z0-9._-]/g, "_") + ".json";
}

export function readEntry(session) {
  try { return JSON.parse(readFileSync(join(BOARD_DIR, fileName(session)), "utf8")); } catch { return null; }
}

export function writeEntry(entry) {
  mkdirSync(BOARD_DIR, { recursive: true });
  const name = fileName(entry.session);
  const tmp = join(BOARD_DIR, `.${name}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(entry, null, 2) + "\n", "utf8");
    renameSync(tmp, join(BOARD_DIR, name));
  } catch (e) {
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
}

export function recordBoard({ session, id, cwd, project, ctx, text }) {
  const before = readEntry(session);
  writeEntry(buildEntry({
    session,
    project,
    branch: currentBranch(cwd),
    ticketBefore: before && typeof before.ticket === "string" ? before.ticket : "",
    text,
    ctx,
    retired: isRetired([id, session]),
  }));
}

export function loadBoard(now = Date.now()) {
  let names = [];
  try { names = readdirSync(BOARD_DIR).filter((n) => n.endsWith(".json")); } catch { return []; }
  const entries = [];
  for (const n of names) {
    const file = join(BOARD_DIR, n);
    let entry = null;
    try { entry = JSON.parse(readFileSync(file, "utf8")); } catch { entry = null; }
    let at = Date.parse(entry && entry.updated ? entry.updated : "");
    if (!Number.isFinite(at)) {
      try { at = statSync(file).mtimeMs; } catch { continue; }
    }
    if (now - at > KEEP_MS) {
      try { unlinkSync(file); } catch {}
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    entries.push({
      session: String(entry.session || n.slice(0, -5)),
      project: String(entry.project || ""),
      branch: String(entry.branch || ""),
      ticket: String(entry.ticket || ""),
      state: String(entry.state || "working"),
      until: String(entry.until || ""),
      what: String(entry.what || ""),
      line: String(entry.line || ""),
      links: Array.isArray(entry.links) ? entry.links.map(String) : [],
      ctx: Number(entry.ctx) || 0,
      updated: new Date(at).toISOString(),
    });
  }
  return entries;
}
