#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_EXT, SCRATCH, builtinChecks, changedFiles, gitStatus, gitTop, planChecks, projectConfig, runCommand, tail } from "./lib/checks.mjs";
import { finalTurn, toolCalls } from "./lib/evidence.mjs";
import { record } from "./lib/findings.mjs";
import { logRun } from "./lib/hook-log.mjs";
import { repoKey } from "./lib/repo.mjs";
import { ADMITS_UNVERIFIED, DONE_CLAIM, EDIT_TOOLS, currentTurn } from "./lib/turn.mjs";
import { normalizeInput } from "./lib/codex.mjs";

const BUDGET_MS = Number(process.env.KEELSON_GATE_BUDGET_MS || 60000);
const MAX_BLOCKS = 2;
const PYTHON_TOOLS = /^(\S*\/)?(ruff|mypy|pytest|lint-imports|pyright|python3?|uv|poetry)$/;
const JS_TOOLS = /^(\S*\/)?(npm|npx|pnpm|yarn|eslint|tsc|vitest|jest|node)$/;
const STATE = join(homedir(), ".agent", "quality-gate.json");
const TRUSTED = join(homedir(), ".agent", "trusted-repos.txt");
const QUALITY = process.env.KEELSON_QUALITY_CONFIG || join(dirname(fileURLToPath(import.meta.url)), "..", "global", "quality.json");

if (process.argv[2] === "trust") {
  const root = gitTop(process.argv[3] || process.cwd());
  if (!root) { console.log("Not a git repository: " + (process.argv[3] || process.cwd())); process.exit(1); }
  mkdirSync(dirname(TRUSTED), { recursive: true });
  appendFileSync(TRUSTED, realpathSync(root) + "\n");
  console.log("Trusted repository: " + root + ". The gates will run its turn_checks and the linters from .venv and node_modules.");
  process.exit(0);
}

try {
  await main();
} catch {
  process.exit(0);
}
process.exit(0);

async function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  input = normalizeInput(input);
  const root = gitTop(input.cwd || process.cwd());
  if (!root) return;
  const turn = currentTurn(input.transcript_path);
  if (!turn.tools.some((t) => EDIT_TOOLS.has(t.name) || /^(Bash|Agent|Task)$/.test(t.name))) return;
  const status = gitStatus(root);
  const changedAll = changedFiles(root, turn.tools, turn.startedAt, status);
  const changed = changedAll.filter((f) => CODE_EXT.has(extname(f)) && !SCRATCH.test(f));
  const started = Date.now();

  const project = projectConfig(root);
  const quality = readJson(QUALITY) || {};
  const trustedRepo = quality.trust_repo_commands === true || isTrusted(root);
  const ctx = { root, changed, changedAll, status, trusted: trustedRepo, startedAt: turn.startedAt, noComments: project.noComments || quality.no_comments === true };
  const deadline = Date.now() + BUDGET_MS;
  const problems = [];
  const slow = [];
  const trusted = trustedRepo;
  const commands = planChecks(root, changed, project, { trusted, log: true });
  const trustNote = project.turn.length && !trusted && firstNote(input.session_id || "?", root)
    ? `.agent/project.yaml has turn_checks, but the repository is not trusted, so their commands did not run. To trust it: node ${process.argv[1]} trust ${root}` : "";
  const uncovered = changed.length && !commands.length ? [...new Set(changed.map((f) => extname(f)))] : [];
  const uncoveredNote = uncovered.length && !project.turn.length && !project.full.some((c) => relevant(c, changed)) && firstNote(input.session_id || "?", root, "uncovered")
    ? `The gates found no check for the changed code (${uncovered.join(", ")}): .agent/project.yaml has no turn_checks or checks for it, and the repository has no linter configured. Add turn_checks, for example "py: ruff check {files}".` : "";
  for (const c of commands) {
    const left = deadline - Date.now();
    if (left < 1000) { slow.push(c.name); continue; }
    const r = runCommand(c.cmd, root, left);
    if (r.timedOut) slow.push(c.name);
    else if (!r.ok) problems.push({ name: c.name, class: classOf(c.name), file: changed[0], text: tail(r.output, 15) });
  }
  for (const f of await builtinChecks(ctx)) problems.push({ name: f.check, class: f.class, file: f.file, text: f.message });
  const notRun = changed.length && DONE_CLAIM.test(turn.text) && !ADMITS_UNVERIFIED.test(turn.text) ? missingFullChecks(project.full, changed, input.transcript_path) : [];
  if (notRun.length) problems.push({ name: "checks", text: `the reply says "done", but the checks from .agent/project.yaml did not run after the last change: ${notRun.join("; ")}` });

  const note = [slow.length ? `The quality gates exceeded ${BUDGET_MS / 1000} s: ${slow.join(", ")}. Run them yourself before saying "done".` : "", trustNote, uncoveredNote].filter(Boolean).join(" ");
  const run = { repo: repoKey(root), changed: changed.length, files: changedAll.length, checks: commands.map((c) => c.name), problems: problems.map((p) => p.name), slow, ms: Date.now() - started, ...(uncovered.length ? { uncovered } : {}) };
  if (!problems.length) {
    if (changedAll.length) logRun("quality-gate", { ...run, outcome: slow.length ? "slow" : "pass" });
    if (note) process.stdout.write(JSON.stringify({ systemMessage: note }));
    return;
  }
  record(problems.filter((p) => p.class).map((p) => ({
    repo: repoKey(root), root, source: "gate", class: p.class, severity: "low", file: p.file, evidence: `${p.name}: ${p.text.split("\n")[0]}`,
  })));
  const list = problems.map((p) => `• ${p.name}\n${p.text}`).join("\n");
  if (bump(input.session_id || "?", turn.key, input.stop_hook_active === true) > MAX_BLOCKS) {
    logRun("quality-gate", { ...run, outcome: "released" });
    process.stdout.write(JSON.stringify({ systemMessage: `The quality gates still fail after ${MAX_BLOCKS} attempts, so the turn is released. Remaining:\n${list}` }));
    return;
  }
  logRun("quality-gate", { ...run, outcome: "block" });
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `Quality gates${changed.length ? ` for the changed files (${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", …" : ""})` : ""}:\n${list}\n` +
      `Fix the problems and end the turn again. If this is a false positive, say why in one line.${note ? " " + note : ""}`,
  }));
}

function classOf(name) {
  if (/mypy|tsc|typecheck|pyright/.test(name)) return "types";
  if (/pytest|vitest|jest|test/.test(name)) return "tests";
  return "lint";
}

function missingFullChecks(full, changed, transcript) {
  const ft = finalTurn(transcript);
  const ran = toolCalls(transcript, ft).turnAfterEdit.filter((c) => c.name === "Bash" && c.ok !== false).map((c) => c.command).join("\n");
  return full.filter((check) => relevant(check, changed) && check.split("&&").map((s) => s.trim()).filter((s) => s && !s.startsWith("cd ")).some((seg) => !ran.includes(signature(seg))));
}

function relevant(check, changed) {
  const dir = check.match(/^\s*cd\s+(\S+)\s*&&/)?.[1]?.replace(/\/$/, "");
  if (dir && !changed.some((f) => f.startsWith(dir + "/"))) return false;
  const tool = check.replace(/^\s*cd\s+\S+\s*&&\s*/, "").split(/\s+/)[0];
  if (PYTHON_TOOLS.test(tool)) return changed.some((f) => /\.pyi?$/.test(f));
  if (JS_TOOLS.test(tool)) return changed.some((f) => /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/.test(f));
  return true;
}

function signature(segment) {
  const words = segment.split(/\s+/).filter((w) => w !== ".");
  return words.slice(0, ["npm", "pnpm", "yarn", "make", "uv", "poetry"].includes(words[0]) ? 3 : 2).join(" ");
}

function bump(session, key, continuing) {
  const state = readJson(STATE) || {};
  const entry = state[session] && (state[session].key === key || continuing) ? state[session] : { key, blocks: 0 };
  entry.blocks += 1;
  entry.at = new Date().toISOString();
  state[session] = entry;
  const keep = Object.entries(state).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 200);
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(Object.fromEntries(keep)) + "\n");
  return entry.blocks;
}

function isTrusted(root) {
  try { return readFileSync(TRUSTED, "utf8").split("\n").includes(realpathSync(root)); } catch { return false; }
}

function firstNote(session, root, kind = "trust") {
  const state = readJson(STATE) || {};
  const key = `${kind}:${session}:${root}`;
  if (state[key]) return false;
  state[key] = { at: new Date().toISOString() };
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(state) + "\n");
  return true;
}

function readJson(file) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null; } catch { return null; }
}
