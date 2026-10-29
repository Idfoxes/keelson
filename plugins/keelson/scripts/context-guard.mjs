#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { repoKey } from "./lib/repo.mjs";
import { lastTurn } from "./lib/transcript.mjs";
import { STOP_TOKENS, SPAWN_LOAD, SPAWN_TOOL, CLOSED_LINE, COMPACT_NOTE, allowHere, continuation, remember, retired, signalAt, signaled } from "./lib/guard-state.mjs";
import { isCronPrompt } from "./lib/cron-prompts.mjs";
import { logRun } from "./lib/hook-log.mjs";
import { handoffFor } from "./lib/handoff-store.mjs";

const WARN = Number(process.env.AGENT_CTX_WARN_TOKENS || 120000);
const STOP = STOP_TOKENS;
const OVERRIDE = "!";
const SPAWN = SPAWN_TOOL;
const HANDOFF = join(dirname(fileURLToPath(import.meta.url)), "handoff.mjs");
const MACHINE_TAGS = /^<(cross-session-message|scheduled-task|task-notification|system-reminder|agent-message|subagent)\b|^#\s*Autonomous loop tick/i;

try {
  main();
} catch {
  process.exit(0);
}
process.exit(0);

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  const session = String(d.session_id || "");
  if (session && signaled(session) && String(d.prompt || "").trimStart().startsWith(OVERRIDE)) allowHere(session);
  if (session && retired(session)) {
    const kind = machineKind(session, String(d.prompt || ""));
    if (kind) {
      logRun("retired-block", { kind });
      process.stdout.write(JSON.stringify({
        decision: "block",
        reason: "Session closed: the work was handed to a continuation, and this automated message is not handled here.",
      }));
      return;
    }
  }
  const used = lastTurn(d.transcript_path).ctx;
  if (!used || used < WARN) return;

  const k = Math.round(used / 1000) + "k";
  if (used >= STOP && session && signaled(session)) {
    const prompt = String(d.prompt || "");
    if (prompt.trimStart().startsWith(OVERRIDE)) return;
    say(`This session's context is ${k} tokens, the handoff is already written, and continuing here is expensive. Do not carry out the user's request here ` +
      `and call no other tools except ToolSearch and the new-session tool ${SPAWN}. ${SPAWN_LOAD} Use it to create the continuation: paste into its prompt, verbatim, ` +
      `the user's request and the handoff text below, with the first line "Continuing a task from a previous session in this repository" and the line "${CLOSED_LINE}". ` +
      `Reply in one line: the request was moved to a new session, it is already running, and it is visible in the list on the left. If the tool is missing, say in one line: ` +
      `press New and write "continue from the handoff"; to continue here anyway, start the message with "${OVERRIDE}".\n\n` +
      `The user's request:\n${prompt}\n\nHandoff:\n${handoffText(d.cwd, session)}`);
    return;
  }
  if (used >= STOP) {
    if (session) remember(session, used, "prompt");
    say(`This session's context is ${k} tokens, ${COMPACT_NOTE}. Answer the question. ` + continuation(session) + " Say this once, without insisting.");
  } else {
    say(`This session's context is ${k} tokens. Keep answers shorter and do not reread files you already read. ` +
      `Do not suggest a new chat yet.`);
  }
}

function machineKind(session, prompt) {
  const text = prompt.trimStart();
  if (text.startsWith(OVERRIDE)) return "";
  const tag = MACHINE_TAGS.exec(text);
  if (tag) return tag[1] || "loop";
  return isCronPrompt(session, prompt) ? "cron" : "";
}

function handoffText(cwd, session) {
  const dir = cwd || process.cwd();
  const found = handoffFor(repoKey(dir), { cwd: dir, session, since: signalAt(session) });
  if (found.kind !== "own") return `(this session has no handoff: first write it with node ${HANDOFF} write --session ${session}, five lines: Task, Stopped, Files, Next, Model, and paste that one into the prompt, not someone else's)`;
  return found.handoff.body;
}

function say(text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text },
  }));
}
