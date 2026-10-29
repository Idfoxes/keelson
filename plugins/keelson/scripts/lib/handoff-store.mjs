import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HANDOFF_DIR = join(homedir(), ".agent", "handoff");
export const HANDOFF_TTL_MS = 36 * 3600 * 1000;
const MAX_LINES = 40;

export function currentBranch(cwd) {
  try {
    return execFileSync("git", ["-C", cwd || process.cwd(), "branch", "--show-current"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
  } catch {
    return "";
  }
}

function files(key) {
  return { md: join(HANDOFF_DIR, key + ".md"), meta: join(HANDOFF_DIR, key + ".json") };
}

export function writeHandoff(key, lines, cwd, session = "") {
  const { md, meta } = files(key);
  mkdirSync(HANDOFF_DIR, { recursive: true });
  const now = new Date();
  writeFileSync(md, `${now.toISOString().slice(0, 16).replace("T", " ")}\n${lines.slice(0, MAX_LINES).join("\n")}\n`, "utf8");
  writeFileSync(meta, JSON.stringify({ at: now.toISOString(), branch: currentBranch(cwd), session, consumedBy: null }) + "\n", "utf8");
}

export function readHandoff(key) {
  const { md, meta } = files(key);
  if (!existsSync(md)) return null;
  let info = {};
  try { info = JSON.parse(readFileSync(meta, "utf8")) || {}; } catch { info = { at: new Date(statSync(md).mtimeMs).toISOString(), branch: "", consumedBy: null }; }
  const [stamp, ...rest] = readFileSync(md, "utf8").trim().split("\n");
  const body = rest.slice(0, MAX_LINES).join("\n");
  const task = (body.match(/^(?:Task|Задача):\s*(.+)$/m) || [])[1] || "";
  return { key, stamp, body, task, meta: info, ageMs: Date.now() - Date.parse(info.at || 0) };
}

export function markConsumed(key, session) {
  const h = readHandoff(key);
  if (!h || !session) return;
  writeFileSync(files(key).meta, JSON.stringify({ ...h.meta, consumedBy: session, consumedAt: new Date().toISOString() }) + "\n", "utf8");
}

export function handoffFor(key, { cwd, session = "", since = "" } = {}) {
  const h = readHandoff(key);
  if (!h || h.ageMs > HANDOFF_TTL_MS) return { kind: "none" };
  const branch = currentBranch(cwd);
  const sameBranch = !h.meta.branch || !branch || h.meta.branch === branch;
  const free = !h.meta.consumedBy || h.meta.consumedBy === session;
  const author = !since || !h.meta.session || !session || h.meta.session === session;
  const recent = author && (!since || Date.parse(h.meta.at || 0) >= Date.parse(since));
  return { kind: sameBranch && free && recent ? "own" : "foreign", handoff: h };
}
