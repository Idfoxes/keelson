#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isMachineTurn, jaccard, STOP, stems } from "./lib/text.mjs";
import { redact } from "./lib/redact.mjs";
import { repoKey } from "./lib/repo.mjs";

const FILE = join(homedir(), ".agent", "lessons.jsonl");
const GLOBAL = "*";
const SAME_LESSON = 0.5;
const MAX_SHOWN = 3;
const MAX_EVIDENCE = 5;
const STALE_DAYS = 60;
const VERB_PREFIX = /^(пере|под|при|про|раз|рас|вы|за|из|ис|на|от|по|до|re)(?=\p{L}{4})/u;

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i < 0 || argv[i + 1] === undefined ? d : argv[i + 1]; };
const flag = (n) => argv.includes("--" + n);

try {
  if (argv[0] === "add") add();
  else if (argv[0] === "list") list();
  else hook();
} catch (e) {
  if (argv.length) { console.error(String(e.message || e)); process.exit(1); }
}
process.exit(0);

function add() {
  const text = String(argv[1] || "").trim();
  const when = String(opt("when", "")).trim();
  if (!text || !when) {
    console.error('Usage: lessons.mjs add "what to do next time" --when "words that identify the situation" --evidence "the words of the user" [--global | --project name]');
    process.exit(2);
  }
  const project = flag("global") ? GLOBAL : opt("project", repoKey(process.cwd()));
  const evidence = { ts: new Date().toISOString(), quote: redact(String(opt("evidence", ""))).text.slice(0, 300) };
  const lessons = load();
  const key = new Set(stems(text + " " + when));
  const twin = lessons.find((l) => l.project === project && jaccard(key, new Set(stems(l.lesson + " " + l.when))) >= SAME_LESSON);
  if (twin) {
    twin.confirmed += 1;
    twin.evidence = [...twin.evidence, evidence].slice(-MAX_EVIDENCE);
    if (text.length > twin.lesson.length) twin.lesson = text;
    save(lessons);
    console.log(`Lesson already recorded, confirmed ${twin.confirmed} times: ${twin.lesson}`);
    return;
  }
  lessons.push({ id: Date.now().toString(36), ts: evidence.ts, project, lesson: text, when, evidence: [evidence], confirmed: 1, shown: 0, lastShown: null });
  save(lessons);
  console.log(`Lesson recorded (${project === GLOBAL ? "for all repositories" : project}): ${text}`);
}

function list() {
  const project = opt("project", null);
  const rows = load().filter((l) => !project || l.project === project || l.project === GLOBAL)
    .sort((a, b) => b.confirmed - a.confirmed || b.shown - a.shown);
  if (!rows.length) { console.log("No lessons."); return; }
  for (const l of rows) {
    console.log(`${String(l.confirmed).padStart(2)}× confirmed, shown ${l.shown}  [${l.project === GLOBAL ? "all" : l.project}]  ${l.lesson}`);
  }
}

function hook() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  const prompt = String(d.prompt || "");
  if (!prompt.trim() || isMachineTurn(prompt)) return;
  const lessons = load();
  if (!lessons.length) return;
  const project = repoKey(d.cwd || process.cwd());
  const words = new Set(wordKeys(prompt).flat());
  const hits = lessons
    .filter((l) => l.project === GLOBAL || l.project === project)
    .filter((l) => l.confirmed > 1 || Date.now() - Date.parse(l.lastShown || l.ts) < STALE_DAYS * 86400000)
    .map((l) => ({ l, score: Math.max(0, ...l.when.split(";").map((p) => match(wordKeys(p), words))) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.l.confirmed - a.l.confirmed)
    .slice(0, MAX_SHOWN);
  if (!hits.length) return;
  bump(new Set(hits.map(({ l }) => l.id)), new Date().toISOString());
  const lines = hits.map(({ l }) => `- ${l.lesson}${l.confirmed > 1 ? ` (the user corrected this ${l.confirmed} times)` : ""}`);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: "Lessons from the user's past corrections; apply them if they relate to this request:\n" + lines.join("\n"),
    },
  }));
}

/** Each word gives its 5-letter stem and its 4-letter root without a verb prefix, so "check" meets "recheck". */
function wordKeys(s) {
  const words = (String(s || "").toLowerCase().match(/\p{L}{3,}/gu) || []).filter((w) => !STOP.has(w));
  const unique = new Map(words.map((w) => [w.slice(0, 5), [w.slice(0, 5), w.replace(VERB_PREFIX, "").slice(0, 4)]]));
  return [...unique.values()];
}

function match(when, words) {
  const inter = when.filter((keys) => keys.some((k) => words.has(k))).length;
  if (!when.length) return 0;
  if (when.length === 1) return inter;
  return inter >= 2 && inter / when.length >= 0.5 ? inter : 0;
}

function load() {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function bump(ids, now) {
  const fresh = load();
  for (const l of fresh) if (ids.has(l.id)) { l.shown += 1; l.lastShown = now; }
  save(fresh);
}

function save(lessons) {
  mkdirSync(dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, lessons.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  renameSync(tmp, FILE);
}
