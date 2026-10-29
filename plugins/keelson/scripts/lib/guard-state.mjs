import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const STOP_TOKENS = Number(process.env.AGENT_CTX_STOP_TOKENS || 260000);
export const SPAWN_TOOLS = ["mcp__ccd_session__start_session", "mcp__ccd_session__spawn_task"];
export const SPAWN_TOOL = SPAWN_TOOLS.join(" (in older desktop versions ") + ")";
export const SPAWN_LOAD = `The tool is deferred: first load it through ToolSearch with the query "select:${SPAWN_TOOLS[0]}", and only if the search returns nothing, treat it as absent. It starts a new session at once, and the session appears in the list on the left with no card and no click.`;

export const COMPACT_NOTE = "automatic compaction did not happen";
export const CLOSED_LINE = "Do not write to the previous session: it is closed, write the result in your own chat";

const STATE = join(homedir(), ".agent", "context-guard.json");
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const HANDOFF = join(SCRIPTS, "handoff.mjs");
const KEEP_SESSIONS = 200;

export function signaled(session) {
  return Boolean(readState()[session]);
}

export function signalAt(session) {
  return readState()[session]?.at || "";
}

export function allowHere(session) {
  const state = readState();
  if (!state[session]) return;
  state[session] = { ...state[session], override: new Date().toISOString() };
  writeState(state);
}

export function retire(session) {
  const state = readState();
  if (!state[session] || retired(session)) return;
  state[session] = { ...state[session], retired: new Date().toISOString() };
  writeState(state);
}

export function retired(session) {
  const s = readState()[session];
  return Boolean(s?.retired && !(s.override && s.override > s.retired));
}

export function overridden(session) {
  const s = readState()[session];
  return Boolean(s?.override && s.override >= s.at);
}

export function remember(session, ctx, where) {
  const state = readState();
  state[session] = { at: new Date().toISOString(), ctx, where };
  writeState(Object.fromEntries(Object.entries(state).sort((a, b) => (a[1].at < b[1].at ? 1 : -1)).slice(0, KEEP_SESSIONS)));
}

function readState() {
  try { return JSON.parse(readFileSync(STATE, "utf8")) || {}; } catch { return {}; }
}

function writeState(state) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function continuation(session = "") {
  return `Write the handoff with node ${HANDOFF} write${session ? " --session " + session : ""} and a five-line text through a heredoc: Task, Stopped, Files, Next, Model (sonnet if the next step is implementing a ready plan with tests; opus if it is finding a cause or design). ` +
    `Before continuing, remove whatever would wake this session: your own reminders (CronList, then CronDelete for each) and your own Monitors and background watchers that will no longer be needed (TaskStop); the tools are deferred, load them through ToolSearch "select:CronList,CronDelete,TaskStop". ` +
    `Then create the continuation with the tool ${SPAWN_TOOL}, ` +
    `pasting the handoff into the prompt. ${SPAWN_LOAD} Put the line "${CLOSED_LINE}" into the continuation prompt. Without that tool, ask the user to press New and write "continue from the handoff". End the turn with one line on how the continuation was opened.`;
}
