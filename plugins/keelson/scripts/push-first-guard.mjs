#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentBranch, defaultBranch, gitRoot } from "./lib/agent-dir.mjs";
import { finalTurn } from "./lib/evidence.mjs";
import { logRun } from "./lib/hook-log.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const NOT_BEFORE = String.raw`(?<!(?:не|без|not|without)\s+(?:\p{L}+\s+)?)`;
const WAIT = String.raw`(?:жд(?:у|ём|ем|ать)|ожида(?:ю|ем|ть)|await(?:ing)?|wait(?:ing)?)`;
const FILLER = String.raw`(?:\s+(?:на|результат(?:а|ов)?|окончани[яе]|завершени[яе]|пока|пройд[её]т|закончится|for|the|until|on|to\s+finish))*`;
const FULL_RUN = "\\s+[`]?(?:make\\s+)?(?:gate-full|full[\\s-]gate|full\\s+(?:local\\s+)?(?:run|suite|gate)|полн\\p{L}*\\s+(?:локальн\\p{L}*\\s+)?(?:прогон\\p{L}*|gate))(?![\\p{L}-])";
const WAITING = new RegExp(String.raw`(?<![\p{L}])${NOT_BEFORE}${WAIT}[,:]?${FILLER}${FULL_RUN}`, "iu");
const QUOTED = /```[\s\S]*?```|«[^»\n]*»|"[^"\n]*"/g;

try {
  main();
} catch {
  process.exit(0);
}
process.exit(0);

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  if (d.stop_hook_active) return;
  const text = finalTurn(d.transcript_path).text || String(d.last_assistant_message || "");
  if (!WAITING.test(text.replace(QUOTED, " "))) return;

  const root = gitRoot(d.cwd || process.cwd());
  if (!root) return;
  const branch = currentBranch(root);
  const base = defaultBranch(root);
  if (!branch || branch === base) return;
  const state = unpushed(root, branch, base);
  if (!state) return;

  logRun("push-first-guard", { repo: basename(root), branch, ref: state.ref, ahead: state.ahead });
  const where = state.ref ? `${plural(state.ahead)} not in ${state.ref}` : "the branch has not been published yet";
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `The reply waits for the full run, but branch "${branch}" is not pushed (${where}). ` +
      `The full run runs on the pushed commit, so there is no need to wait for it before the push (rules.d/32-fix-now.md). ` +
      `First run the quick checks on the changed files and the repository pre-push (make prepush or its equivalent), then push: git push. ` +
      `Start the full run on the new commit and rewrite the reply: what was pushed, the pull or merge request link if one exists, and that the full run is running on this commit. Change nothing else.`,
  }));
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
  } catch {
    return null;
  }
}

function resolves(root, ref) {
  return git(root, ["rev-parse", "--verify", "--quiet", ref]) !== null;
}

function aheadOf(root, ref) {
  const n = Number(git(root, ["rev-list", "--count", `${ref}..HEAD`]));
  return Number.isFinite(n) ? n : null;
}

function publishedRef(root, branch, base) {
  const upstream = git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const candidates = [];
  if (upstream && upstream !== `${upstream.split("/")[0]}/${base}`) candidates.push(upstream);
  candidates.push(`origin/${branch}`);
  return candidates.find((ref) => resolves(root, ref)) || "";
}

function unpushed(root, branch, base) {
  const ref = publishedRef(root, branch, base);
  if (ref) {
    const ahead = aheadOf(root, ref);
    return ahead === 0 ? null : { ref, ahead: ahead ?? 0 };
  }
  const baseRef = [`origin/${base}`, base].find((r) => resolves(root, r));
  const own = baseRef ? aheadOf(root, baseRef) : null;
  return own === 0 ? null : { ref: "", ahead: own ?? 0 };
}

function plural(n) {
  const word = n === 1 ? "commit" : "commits";
  return `${n} ${word}`;
}
