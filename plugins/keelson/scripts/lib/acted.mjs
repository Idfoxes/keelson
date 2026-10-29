import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { gitTop } from "./checks.mjs";

export const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
export const WINDOW_MS = 6 * 3600 * 1000;
export const COMMIT_WINDOW_MS = 48 * 3600 * 1000;
const WORKTREE = /^(.*?)\/\.claude\/worktrees\/[^/]+(?:\/(.*))?$/;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
}

export function ledgerEdits(since, dir = join(homedir(), ".agent", "context-ledger")) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      const r = JSON.parse(l);
      return r.ts >= since && EDIT_TOOLS.has(r.tool) ? [{ ts: r.ts, tool: r.tool, target: String(r.target || "") }] : [];
    } catch {
      return [];
    }
  }));
}

export function fileOf(finding) {
  return String(finding.file || "").replace(/:\d+(-\d+)?$/, "");
}

export function repoFile(finding) {
  const file = fileOf(finding);
  if (!file) return null;
  if (isAbsolute(file)) {
    const inWorktree = file.match(WORKTREE);
    if (inWorktree && inWorktree[2]) return { root: inWorktree[1], rel: inWorktree[2] };
    const top = existsSync(dirname(file)) ? gitTop(dirname(file)) : "";
    return top ? { root: top.replace(WORKTREE, "$1"), rel: relative(top, file) } : null;
  }
  const root = String(finding.root || "").replace(WORKTREE, "$1");
  return root ? { root, rel: file } : null;
}

export function blobOf(path) {
  try {
    return execFileSync("git", ["hash-object", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

function editedPath(target) {
  const main = join(target.root, target.rel);
  const worktree = new RegExp(`^${escape(target.root)}/\\.claude/worktrees/[^/]+/${escape(target.rel)}$`);
  const sameRepo = `/${basename(target.root)}/${target.rel}`;
  return (path) => path === main || worktree.test(path) || path.endsWith(sameRepo);
}

export function commitIndex(root, since, until) {
  if (!existsSync(root)) return [];
  let out = "";
  try {
    out = git(root, ["log", "--all", `--since=${since}`, `--until=${until}`, "--name-only", "--format=%x00%H %cI"]);
  } catch {
    return [];
  }
  return out.split("\0").filter(Boolean).map((block) => {
    const [head, ...files] = block.split("\n").filter(Boolean);
    const [hash, at] = head.split(" ");
    return { hash, at: Date.parse(at), files: new Set(files) };
  });
}

function changedInGit(finding, target, commits) {
  const from = Date.parse(finding.ts);
  const to = from + COMMIT_WINDOW_MS;
  for (const c of commits) {
    if (c.at < from || c.at > to || !c.files.has(target.rel)) continue;
    let blob = "";
    try { blob = git(target.root, ["rev-parse", `${c.hash}:${target.rel}`]).trim(); } catch { blob = ""; }
    if (blob !== finding.blob) return true;
  }
  const local = [join(target.root, target.rel), ...(isAbsolute(fileOf(finding)) ? [fileOf(finding)] : [])];
  return local.some((path) => {
    try {
      const at = statSync(path).mtimeMs;
      return at >= from && at <= to && blobOf(path) !== finding.blob;
    } catch {
      return false;
    }
  });
}

export function actedOn(findings, edits, { windowMs = WINDOW_MS } = {}) {
  const spans = new Map();
  for (const f of findings) {
    const target = f.blob ? repoFile(f) : null;
    if (!target) continue;
    const at = Date.parse(f.ts);
    const span = spans.get(target.root) || { from: at, to: at };
    spans.set(target.root, { from: Math.min(span.from, at), to: Math.max(span.to, at) });
  }
  const commits = new Map([...spans].map(([root, s]) => [root, commitIndex(root, new Date(s.from).toISOString(), new Date(s.to + COMMIT_WINDOW_MS).toISOString())]));
  return findings.map((f) => {
    const target = repoFile(f);
    if (!target) return { ...f, acted: null };
    const from = Date.parse(f.ts);
    const matches = editedPath(target);
    const edited = edits.some((e) => {
      const at = Date.parse(e.ts);
      return at >= from && at <= from + windowMs && matches(e.target);
    });
    return { ...f, acted: edited || (Boolean(f.blob) && changedInGit(f, target, commits.get(target.root) || [])) };
  });
}

export function actedSummary(rows, { minClass = 5, weak = 0.3 } = {}) {
  const known = rows.filter((r) => r.acted !== null);
  const byClass = new Map();
  for (const r of known) {
    const c = byClass.get(r.class) || { n: 0, acted: 0 };
    c.n += 1; c.acted += r.acted ? 1 : 0;
    byClass.set(r.class, c);
  }
  const share = known.length ? known.filter((r) => r.acted).length / known.length : null;
  const serious = known.filter((r) => r.severity === "high" || r.severity === "medium");
  const seriousShare = serious.length ? serious.filter((r) => r.acted).length / serious.length : null;
  const weakClasses = [...byClass].filter(([, c]) => c.n >= minClass && c.acted / c.n < weak).map(([name]) => name);
  return { total: rows.length, known: known.length, withBlob: known.filter((r) => r.blob).length, share, serious: serious.length, seriousShare, byClass: [...byClass].sort((a, b) => b[1].n - a[1].n), weakClasses };
}
