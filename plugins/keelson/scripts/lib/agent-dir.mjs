import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brief, loadConventions } from "./conventions.mjs";

export const CONTEXT_BUDGET = 4000;
export const AGENTS_BUDGET = 4000;
export const INJECT_BUDGET = 6000;
export const ADR_DIRS = ["docs/adr", "docs/decisions", "doc/adr", "adr", ".agent/decisions"];
const MIN_PARTIAL = 300;
const JOINER = "\n\n";
const CUT_MARK = "\n(section truncated)";
export const HISTORY_SECTIONS = /^(done|history|changelog|сделано|история)(?=[\s:.,(]|$)/iu;

export function gitRoot(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
  } catch {
    return "";
  }
}

export const MAIN_LOG = ".agent/log.md";
export const SHARED_RECORDS = [".agent/context.md", ".agent/log.md", ".agent/decisions.md"];
const TASK_LOG_DIR = ".agent/log";
const RECORDS_BRANCH = /^records-/i;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;
const SLUG_MAX = 60;
const HASH_CHARS = 8;

export const LOG_HEADER = `# Session log

One entry per session that changed the repository, newest at the bottom. Entry header: \`## YYYY-MM-DD HH:MM · who · tool\`. Entries marked (auto) were written by the SessionEnd hook from the transcript; a human or agent entry is better.
`;

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
  } catch {
    return null;
  }
}

export function currentBranch(root) {
  return git(root, ["symbolic-ref", "--short", "HEAD"]) || "";
}

export function defaultBranch(root) {
  const head = git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head) return head.replace(/^origin\//, "");
  for (const name of ["main", "master"]) {
    const known = [`refs/heads/${name}`, `refs/remotes/origin/${name}`]
      .some((ref) => git(root, ["show-ref", "--verify", "--quiet", ref]) !== null);
    if (known) return name;
  }
  return "main";
}

export function isRecordsBranch(branch) {
  return RECORDS_BRANCH.test(branch || "");
}

export function isTaskBranch(root, branch) {
  if (!branch || isRecordsBranch(branch) || branch === defaultBranch(root)) return false;
  return git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]) !== null;
}

export function branchSlug(branch) {
  const name = String(branch || "");
  const hash = createHash("sha1").update(name).digest("hex").slice(0, HASH_CHARS);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) return `branch-${hash}`;
  if (slug.length <= SLUG_MAX) return slug;
  return `${slug.slice(0, SLUG_MAX - HASH_CHARS - 1).replace(/-+$/, "")}-${hash}`;
}

function localDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function existingTaskLog(root, name) {
  const dir = join(root, TASK_LOG_DIR);
  if (!existsSync(dir)) return "";
  const found = readdirSync(dir).filter((f) => DATE_PREFIX.test(f) && f.replace(DATE_PREFIX, "") === `${name}.md`).sort();
  return found.length ? `${TASK_LOG_DIR}/${found[found.length - 1]}` : "";
}

export function logFile(root) {
  const branch = currentBranch(root);
  if (!isTaskBranch(root, branch)) return MAIN_LOG;
  const slug = branchSlug(branch);
  return existingTaskLog(root, slug) || `${TASK_LOG_DIR}/${localDate()}-${slug}.md`;
}

export function appendLogEntry(root, heading, body) {
  const file = join(root, logFile(root));
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, LOG_HEADER, "utf8");
  }
  const text = readFileSync(file, "utf8");
  const sep = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  appendFileSync(file, `${sep}## ${heading}\n\n${body.trim()}\n`, "utf8");
  return file;
}

export function adrDir(root) {
  return ADR_DIRS.find((d) => existsSync(join(root, d))) || ".agent/decisions";
}

export function splitSections(text) {
  const sections = [];
  let current = { title: "", lines: [] };
  for (const line of text.split("\n")) {
    if (/^## /.test(line)) {
      sections.push(current);
      current = { title: line.slice(3).trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections.filter((s) => s.lines.join("").trim());
}

export function prioritized(text, budget) {
  const sections = splitSections(text);
  const isHistory = (s) => HISTORY_SECTIONS.test(s.title);
  const ordered = [...sections.filter((s) => !isHistory(s)), ...sections.filter(isHistory)];
  const kept = [];
  const dropped = [];
  let used = 0;
  for (const s of ordered) {
    const body = s.lines.join("\n").trim();
    const room = budget - used - (kept.length ? JOINER.length : 0);
    if (body.length <= room) {
      used += body.length + (kept.length ? JOINER.length : 0);
      kept.push(body);
    } else if (!isHistory(s) && room > MIN_PARTIAL) {
      kept.push(cutAtLine(body, room - CUT_MARK.length) + CUT_MARK);
      used = budget;
      dropped.push((s.title || "(start of file)") + " (partial)");
    } else {
      dropped.push(s.title || "(start of file)");
    }
  }
  return { text: kept.join(JOINER), dropped };
}

function cutAtLine(text, limit) {
  const head = text.slice(0, limit);
  const lastBreak = head.lastIndexOf("\n");
  return lastBreak > 0 ? head.slice(0, lastBreak) : head;
}

export function readableLogFile(root) {
  const task = logFile(root);
  if (existsSync(join(root, task))) return task;
  return MAIN_LOG;
}

function entriesOf(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\n(?=## \d{4}-\d{2}-\d{2})/).filter((e) => /^## \d{4}/.test(e.trim()))
    .map((e) => e.trim());
}

export function logEntries(root) {
  return entriesOf(join(root, readableLogFile(root)));
}

export function loggedSince(root, sinceMs) {
  return [...new Set([logFile(root), MAIN_LOG].filter(Boolean))].some((rel) => {
    const file = join(root, rel);
    return existsSync(file) && statSync(file).mtimeMs > sinceMs && entriesOf(file).length > 0;
  });
}

export function recentFiles(root, dir, n) {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter((f) => f.endsWith(".md") && f !== "README.md").sort().slice(-n);
}

export function projectBrief(cwd, keelson) {
  const root = gitRoot(cwd);
  if (!root) return "";
  const contextFile = join(root, ".agent", "context.md");
  if (!existsSync(contextFile)) return missingContextNote(keelson);
  const raw = readFileSync(contextFile, "utf8");
  const { text, dropped } = prioritized(raw, INJECT_BUDGET);
  const parts = ["Project context (.agent/context.md, already read, do not open it again):\n" + text];
  if (dropped.length) {
    parts.push(`Sections that did not fit: ${dropped.join(", ")}. The file is ${raw.length} characters against a budget of ${CONTEXT_BUDGET}: ` +
      "move the history to .agent/log.md when you update context.md.");
  }
  const dictionary = brief(loadConventions(root));
  if (dictionary) parts.push(dictionary);
  const last = logEntries(root).slice(-1)[0];
  if (last) parts.push(`Latest entry in ${readableLogFile(root)}:\n` + last.split("\n").slice(0, 10).join("\n"));
  const adrs = recentFiles(root, adrDir(root), 5);
  if (adrs.length) parts.push(`Decisions (${adrDir(root)}): ` + adrs.join(", "));
  const incidents = recentFiles(root, ".agent/incidents", 5);
  if (incidents.length) parts.push("Incidents (.agent/incidents): " + incidents.join(", "));
  return parts.join("\n\n");
}

function missingContextNote(keelson) {
  return "There is no .agent/context.md in this repository. If the task changes the repository, run " +
    `\`node ${keelson}/scripts/agent-context.mjs init\` before the first edit, then fill in the What this is, Now and Next sections of .agent/context.md ` +
    "using facts from the repository. For a question with no edits, create nothing.";
}
