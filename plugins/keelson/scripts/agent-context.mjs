#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS_BUDGET, CONTEXT_BUDGET, LOG_HEADER, MAIN_LOG, adrDir, appendLogEntry, gitRoot, loggedSince, projectBrief, splitSections } from "./lib/agent-dir.mjs";
import { RULES, redact } from "./lib/redact.mjs";
import { isMachineTurn } from "./lib/text.mjs";

const KEELSON = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLOCK_START = "<!-- agent-context:start -->";
const BLOCK_END = "<!-- agent-context:end -->";
const SECRET_RULES = new Set(["pem", "token", "password", "envsecret"]);
const REQUIRED_SECTIONS = ["What this is", "Now", "Next"];
const MAP_DENSE_DIRS = 20;
const AUTO_MAX_FILES = 10;
const UNION_LINES = [".agent/log.md merge=union", ".agent/log/*.md merge=union"];
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SENSITIVE_PROMPT = /парол|password|passwd|token|токен|secret|секрет|ключ|api[_ -]?key|credential/i;

const argv = process.argv.slice(2);
const command = argv[0] || "help";
const opt = (n) => { const i = argv.indexOf("--" + n); return i < 0 ? "" : argv[i + 1] || ""; };
const flag = (n) => argv.includes("--" + n);
const positional = () => argv.slice(1).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] || "").match(/^--(dir|tool|cwd)$/)).join(" ");

function help() {
  console.log(`agent-context.mjs: shared .agent/ layer that any agent reads from git

  init [--dir D] [--dry-run]   create missing .agent/ files, AGENTS.md block, CLAUDE.md import, map
  map [--dir D]                regenerate .agent/map.md from git ls-files
  adr "Title" [--dir D]        new decision record, prints its path
  incident "Title" [--dir D]   new incident record, prints its path
  log [--tool T] < text        append a session entry: .agent/log.md on the default and records-* branches, .agent/log/DATE-BRANCH-SLUG.md elsewhere
  check [--dir D]              budgets, required sections, secrets; exit 1 on problems
  brief [--dir D]              what a new session receives at start
  session-end                  SessionEnd hook: auto entry when the session changed the repo`);
}

function rootOf() {
  const dir = opt("dir") || opt("cwd") || process.cwd();
  const root = gitRoot(dir);
  if (!root) throw new Error(`${dir}: not a git repository`);
  return root;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function author(root) {
  try {
    const name = execFileSync("git", ["-C", root, "config", "user.name"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (name) return name;
  } catch {
    return process.env.USER || "unknown";
  }
  return process.env.USER || "unknown";
}

function slug(title) {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "untitled";
}

function writeIfMissing(root, rel, content, created, dry) {
  const file = join(root, rel);
  if (existsSync(file)) return;
  created.push(rel);
  if (dry) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

function agentsBlock(root) {
  const decisions = adrDir(root);
  return `${BLOCK_START}
## Agent context

This repository keeps agent memory in \`.agent/\`, committed with the code. Any agent or person continuing the work reads it instead of re-reading the whole repository.

Start of a session: read \`.agent/context.md\` and \`git log --oneline -10\`. Open \`.agent/map.md\` to find code. Open \`${decisions}/\` and \`.agent/incidents/\` only when the task touches them.

End of a session that changed the repository:
- \`.agent/context.md\`: update Now, Next and Known problems. Keep it under ${CONTEXT_BUDGET} characters; finished work goes to the log, not here. The shared records \`.agent/context.md\`, \`.agent/decisions.md\` and \`.agent/log.md\` change only on the default branch or a \`records-*\` branch.
- Session log: pipe what changed, the evidence and what is left to \`agent-context.mjs log\`; it adds the entry header. On any other branch it writes \`.agent/log/<date>-<branch-slug>.md\`; never edit the shared records there.
- A decision that had alternatives: a new \`${decisions}/NNNN-title.md\` (context, options, decision, consequences) and, on the default or a \`records-*\` branch, one dated line in \`## Decided\` of context.md.
- A fixed failure: a new \`.agent/incidents/YYYY-MM-DD-title.md\` (symptom, root cause, fix, evidence, prevention).
- After moving or adding top-level modules: regenerate \`.agent/map.md\`.
- Commit \`.agent/\` together with the code it describes.

Never write secrets, tokens, passwords or raw logs into \`.agent/\`.
${BLOCK_END}`;
}

function upsertAgentsBlock(root, created, dry) {
  const file = join(root, "AGENTS.md");
  const block = agentsBlock(root);
  if (!existsSync(file)) {
    created.push("AGENTS.md");
    if (!dry) writeFileSync(file, `# ${basename(root)}\n\n${block}\n`, "utf8");
    return;
  }
  const text = readFileSync(file, "utf8");
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  const next = start >= 0 && end > start
    ? text.slice(0, start) + block + text.slice(end + BLOCK_END.length)
    : text.replace(/\s*$/, "\n\n") + block + "\n";
  if (next === text) return;
  created.push(start >= 0 ? "AGENTS.md (block updated)" : "AGENTS.md (block appended)");
  if (!dry) writeFileSync(file, next, "utf8");
}

function ensureClaudeImport(root, created, dry) {
  const file = join(root, "CLAUDE.md");
  if (!existsSync(file)) {
    created.push("CLAUDE.md");
    if (!dry) writeFileSync(file, "@AGENTS.md\n", "utf8");
    return;
  }
  const text = readFileSync(file, "utf8");
  if (/@AGENTS\.md/.test(text)) return;
  created.push("CLAUDE.md (@AGENTS.md import appended)");
  if (!dry) writeFileSync(file, text.replace(/\s*$/, "\n\n") + "@AGENTS.md\n", "utf8");
}

function ensureUnionMerge(root, created, dry) {
  const file = join(root, ".gitattributes");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const missing = UNION_LINES.filter((line) => !text.includes(line));
  if (!missing.length) return;
  created.push(".gitattributes (union merge for the session log)");
  if (!dry) writeFileSync(file, (text ? text.replace(/\s*$/, "\n") : "") + missing.join("\n") + "\n", "utf8");
}

function ignoredPaths(root, paths) {
  try {
    return execFileSync("git", ["-C", root, "check-ignore", ...paths], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function ensureTracked(root, created) {
  const ignored = ignoredPaths(root, [".agent/context.md", ".agent/log.md", ".gitattributes", "AGENTS.md", "CLAUDE.md"]);
  if (!ignored.length) return;
  const file = join(root, ".gitignore");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const present = new Set(text.split("\n").map((l) => l.trim()));
  const rules = ["!.agent/", "!.agent/**", "!.gitattributes", "!AGENTS.md", "!CLAUDE.md"].filter((r) => !present.has(r));
  if (rules.length) writeFileSync(file, text.replace(/\s*$/, "\n\n") + rules.join("\n") + "\n", "utf8");
  const still = ignoredPaths(root, ignored);
  created.push(`.gitignore (re-included ${ignored.join(", ")}${still.length ? "; still ignored: " + still.join(", ") : ""})`);
}

function readmeSummary(root) {
  for (const name of ["README.md", "readme.md", "README.rst", "README"]) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8").split("\n").map((l) => l.trim())
      .find((l) => l && !l.startsWith("#") && !l.startsWith("![") && !l.startsWith("[!") && !l.startsWith("<"));
    if (line) return line.slice(0, 300);
  }
  return "";
}

function contextTemplate(root) {
  const summary = readmeSummary(root);
  return `# ${basename(root)}

## What this is

${summary ? `NEEDS_VERIFICATION, from README: ${summary}` : "NEEDS_VERIFICATION: one or two sentences on what the project does and for whom."}

## Now

NEEDS_VERIFICATION: what works today, what runs where.

## Next

- NEEDS_VERIFICATION

## Known problems

- None recorded yet.

## Decided

- None recorded yet.

## Where to look

- Code map: \`.agent/map.md\`
- Decisions: \`${adrDir(root)}/\`
- Incidents: \`.agent/incidents/\`
- Session log: \`.agent/log.md\`
`;
}

const ADR_README = `# Decisions

One file per decision that had alternatives: \`NNNN-title.md\`. Create with \`node <Keelson>/scripts/agent-context.mjs adr "Title"\` or by hand.

Sections: Status (proposed, accepted, superseded by NNNN), Context, Options, Decision, Consequences.
`;

const INCIDENT_README = `# Incidents

One file per failure that was understood: \`YYYY-MM-DD-title.md\`. Create with \`node <Keelson>/scripts/agent-context.mjs incident "Title"\` or by hand.

Sections: Symptom, Root cause, Fix, Evidence, Prevention. A fix without a confirmed root cause says so in Root cause.
`;

function init() {
  const root = rootOf();
  const dry = flag("dry-run");
  const created = [];
  writeIfMissing(root, ".agent/context.md", contextTemplate(root), created, dry);
  writeIfMissing(root, MAIN_LOG, LOG_HEADER, created, dry);
  writeIfMissing(root, ".agent/incidents/README.md", INCIDENT_README, created, dry);
  if (adrDir(root) === ".agent/decisions") writeIfMissing(root, ".agent/decisions/README.md", ADR_README, created, dry);
  if (!existsSync(join(root, ".agent/map.md"))) {
    created.push(".agent/map.md");
    if (!dry) writeFileSync(join(root, ".agent/map.md"), buildMap(root), "utf8");
  }
  upsertAgentsBlock(root, created, dry);
  ensureClaudeImport(root, created, dry);
  ensureUnionMerge(root, created, dry);
  if (!dry) ensureTracked(root, created);
  const verb = dry ? "Would create or change" : "Created or changed";
  console.log(created.length ? `${verb} in ${root}:\n` + created.map((c) => "  " + c).join("\n") : `${root}: .agent/ layer already complete`);
  if (!dry && created.some((c) => c.startsWith(".agent/context.md"))) {
    console.log("Next: replace NEEDS_VERIFICATION in .agent/context.md with facts from the repository, then commit .agent/ with AGENTS.md.");
  }
}

function trackedFiles(root) {
  return execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n").filter(Boolean).filter((f) => !f.startsWith(".agent/"));
}

function extensionsOf(files) {
  const counts = {};
  for (const f of files) {
    const m = basename(f).match(/\.([A-Za-z0-9]+)$/);
    if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e, n]) => `${e} ${n}`).join(", ");
}

function dirNote(root, dir) {
  const file = join(root, dir, "README.md");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#") && !l.startsWith("!["));
  return line ? " — " + line.slice(0, 120) : "";
}

function commandsOf(root) {
  const out = [];
  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    try {
      const scripts = Object.keys(JSON.parse(readFileSync(pkg, "utf8")).scripts || {});
      if (scripts.length) out.push("npm scripts: " + scripts.slice(0, 12).join(", "));
    } catch {
      out.push("package.json does not parse");
    }
  }
  for (const name of ["Makefile", "justfile", "Taskfile.yml"]) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    const targets = [...readFileSync(file, "utf8").matchAll(/^([A-Za-z][\w-]*):(?!=)/gm)].map((m) => m[1]);
    if (targets.length) out.push(`${name} targets: ` + [...new Set(targets)].slice(0, 12).join(", "));
  }
  return out;
}

function filesPerDir(files) {
  const counts = new Map();
  for (const f of files) {
    const dir = dirname(f);
    if (dir !== ".") counts.set(dir, (counts.get(dir) || 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1]);
}

function buildMap(root) {
  const files = trackedFiles(root);
  const groups = new Map();
  const rootFiles = [];
  for (const f of files) {
    const [top, ...rest] = f.split("/");
    if (!rest.length) { rootFiles.push(f); continue; }
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push(rest.join("/"));
  }
  const lines = [`# Code map: ${basename(root)}`, "",
    `Generated ${today()} from \`git ls-files\` (${files.length} files). Regenerate: \`node <Keelson>/scripts/agent-context.mjs map\`. Hand notes belong in context.md, not here.`, ""];
  lines.push("## Root files", "", rootFiles.slice(0, 30).map((f) => "`" + f + "`").join(", ") || "none", "");
  const commands = commandsOf(root);
  if (commands.length) lines.push("## Commands found", "", ...commands.map((c) => "- " + c), "");
  lines.push("## Directories", "");
  for (const [top, inner] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`- \`${top}/\` ${inner.length} files (${extensionsOf(inner)})${dirNote(root, top)}`);
  }
  const dense = filesPerDir(files).slice(0, MAP_DENSE_DIRS);
  if (dense.length) {
    lines.push("", "## Where the files are", "", "Directories with the most files of their own, deepest path:", "");
    for (const [dir, n] of dense) lines.push(`- \`${dir}/\` ${n}${dirNote(root, dir)}`);
  }
  return lines.join("\n") + "\n";
}

function map() {
  const root = rootOf();
  mkdirSync(join(root, ".agent"), { recursive: true });
  writeFileSync(join(root, ".agent/map.md"), buildMap(root), "utf8");
  console.log(join(root, ".agent/map.md"));
}

function nextAdrNumber(dir) {
  if (!existsSync(dir)) return 1;
  const numbers = readdirSync(dir).map((f) => parseInt(f, 10)).filter((n) => Number.isFinite(n));
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function adr() {
  const root = rootOf();
  const title = positional();
  if (!title) throw new Error('usage: adr "Title"');
  const dir = join(root, adrDir(root));
  const number = String(nextAdrNumber(dir)).padStart(4, "0");
  const file = join(dir, `${number}-${slug(title)}.md`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `# ${number}. ${title}

Status: accepted, ${today()}

## Context

## Options

## Decision

## Consequences
`, "utf8");
  console.log(relative(root, file));
}

function incident() {
  const root = rootOf();
  const title = positional();
  if (!title) throw new Error('usage: incident "Title"');
  const file = join(root, ".agent/incidents", `${today()}-${slug(title)}.md`);
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) throw new Error(`${relative(root, file)} exists`);
  writeFileSync(file, `# ${title}

Date: ${today()}

## Symptom

## Root cause

## Fix

## Evidence

## Prevention
`, "utf8");
  console.log(relative(root, file));
}

function appendLog(root, tool, body) {
  return appendLogEntry(root, `${stamp()} · ${author(root)} · ${tool}`, body);
}

function log() {
  const root = rootOf();
  const body = readFileSync(0, "utf8").trim();
  if (!body) throw new Error("empty entry, nothing written");
  const file = appendLog(root, opt("tool") || "agent", body);
  console.log(`${file}: entry appended`);
}

function secretHits(text) {
  return RULES.filter(([re, , name]) => {
    if (!SECRET_RULES.has(name)) return false;
    const hit = re.test(text);
    re.lastIndex = 0;
    return hit;
  }).map(([, , name]) => name);
}

function agentFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".md") || e.name.endsWith(".yaml")) out.push(rel);
    }
  };
  if (existsSync(join(root, ".agent"))) walk(".agent");
  return out;
}

function check() {
  const root = rootOf();
  const problems = [];
  const contextFile = join(root, ".agent/context.md");
  if (!existsSync(contextFile)) problems.push(".agent/context.md missing: run init");
  else {
    const text = readFileSync(contextFile, "utf8");
    if (text.length > CONTEXT_BUDGET) problems.push(`.agent/context.md ${text.length} chars, budget ${CONTEXT_BUDGET}: move finished work to .agent/log.md`);
    const titles = splitSections(text).map((s) => s.title.toLowerCase());
    for (const s of REQUIRED_SECTIONS) if (!titles.some((t) => t.startsWith(s.toLowerCase()))) problems.push(`.agent/context.md has no "## ${s}"`);
    const open = (text.match(/NEEDS_VERIFICATION/g) || []).length;
    if (open) problems.push(`.agent/context.md has ${open} NEEDS_VERIFICATION`);
  }
  const agents = join(root, "AGENTS.md");
  if (!existsSync(agents)) problems.push("AGENTS.md missing: run init");
  else {
    const text = readFileSync(agents, "utf8");
    if (!text.includes(BLOCK_START)) problems.push("AGENTS.md has no agent-context block: run init");
    if (text.length > AGENTS_BUDGET) problems.push(`AGENTS.md ${text.length} chars, budget ${AGENTS_BUDGET}`);
  }
  const claude = join(root, "CLAUDE.md");
  if (existsSync(claude) && !/@AGENTS\.md/.test(readFileSync(claude, "utf8"))) problems.push("CLAUDE.md does not import @AGENTS.md: Claude Code will not see the agent-context block");
  for (const rel of agentFiles(root)) {
    const hits = secretHits(readFileSync(join(root, rel), "utf8"));
    if (hits.length) problems.push(`${rel}: looks like a secret (${hits.join(", ")})`);
  }
  if (!problems.length) { console.log(`${root}: ok`); return; }
  console.log(problems.map((p) => "- " + p).join("\n"));
  process.exitCode = 1;
}

function brief() {
  const dir = opt("dir") || process.cwd();
  console.log(projectBrief(dir, KEELSON) || "(nothing: not a git repository)");
}

function readTranscript(path) {
  const rows = [];
  if (!path || !existsSync(path)) return rows;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { continue; }
  }
  return rows;
}

function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    try { return join(realpathSync(dirname(path)), basename(path)); } catch { return path; }
  }
}

function sessionFacts(rows, root) {
  let start = "";
  let prompt = "";
  const files = new Set();
  for (const row of rows) {
    if (!start && row.timestamp) start = row.timestamp;
    const m = row.message || {};
    const content = Array.isArray(m.content) ? m.content : [];
    if (!prompt && m.role === "user" && row.type === "user") {
      const text = typeof m.content === "string" ? m.content : content.filter((c) => c.type === "text").map((c) => c.text).join(" ");
      if (text.trim() && !isMachineTurn(text) && !text.startsWith("<")) prompt = text;
    }
    for (const c of content) {
      if (c.type !== "tool_use" || !EDIT_TOOLS.has(c.name)) continue;
      const raw = c.input && (c.input.file_path || c.input.notebook_path);
      const path = raw ? realPath(raw) : "";
      if (path && path.startsWith(root + "/") && !path.includes("/.agent/")) files.add(relative(root, path));
    }
  }
  return { start, prompt, files: [...files] };
}

function gitEmail(root) {
  try {
    return execFileSync("git", ["-C", root, "config", "user.email"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function commitsSince(root, start) {
  const email = gitEmail(root);
  if (!start || !email) return [];
  try {
    return execFileSync("git", ["-C", root, "log", "--no-merges", `--since=${start}`, `--author=${email}`, "--format=%h %s"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function sessionEnd() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  const found = gitRoot(d.cwd || process.cwd());
  if (!found || !existsSync(join(found, ".agent/context.md"))) return;
  const root = realPath(found);
  const { start, prompt, files } = sessionFacts(readTranscript(d.transcript_path), root);
  const commits = commitsSince(root, start);
  if (!files.length && !commits.length) return;
  if (start && loggedSince(root, Date.parse(start))) return;
  const lines = ["(auto)"];
  if (prompt && !SENSITIVE_PROMPT.test(prompt)) lines.push("Request: " + redact(prompt).text.slice(0, 200));
  if (commits.length) lines.push("Commits: " + commits.slice(0, 8).join("; "));
  if (files.length) lines.push(`Files edited (${files.length}): ` + files.slice(0, AUTO_MAX_FILES).join(", ") + (files.length > AUTO_MAX_FILES ? ", ..." : ""));
  appendLog(root, "claude-code", lines.join("\n"));
}

const COMMANDS = { init, map, adr, incident, log, check, brief, "session-end": sessionEnd, help };
try {
  await (COMMANDS[command] || help)();
} catch (e) {
  if (command === "session-end") process.exit(0);
  console.error(String(e && e.message || e));
  process.exit(1);
}
