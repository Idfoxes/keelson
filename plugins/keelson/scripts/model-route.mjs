#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { logRun } from "./lib/hook-log.mjs";
import { agentIs } from "./lib/turn.mjs";

const OWN_MODEL = ["diff-reviewer", "reuse-scout", "log-reader", "Explore", "Plan", "claude-code-guide", "statusline-setup"];
const LIGHT = /^\s*(найди|поищи|ищи|прочитай|посмотри|выпиши|перечисли|сосчитай|посчитай|сверь|собери список|проверь статус|какие файлы|где лежит|grep|find|search|list|count|read|locate|summari[sz]e|look\s+up|check\s+(?:the\s+)?status|collect|compare|gather|which\s+files|where\s+is)(?![\p{L}])/iu;
const HEAVY = /(почему|причин|разбер|спроектир|архитектур|ревью|реализ|напиши|перепиши|рефактор|исправ|почини|добав|созда|сделай|измени|обнови|удали)|\b(?:review(?:s|ed|ing)?|design(?:s|ed|ing)?|debug(?:s|ged|ging)?|root causes?|implement(?:s|ed|ing|ation)?|refactor(?:s|ed|ing)?|fix(?:es|ed|ing)?|add(?:s|ed|ing)?|creat(?:e|es|ed|ing)|build(?:s|ing)?|built|writ(?:e|es|ing|ten)|wrote|edit(?:s|ed|ing)?|updat(?:e|es|ed|ing)|chang(?:e|es|ed|ing)|remov(?:e|es|ed|ing))\b/i;
const STATE = join(homedir(), ".agent", "model-route.json");
const GIVE_UP = 3;
const WINDOW_MS = 10 * 60 * 1000;

try {
  main();
} catch {
  process.exit(0);
}
process.exit(0);

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  const input = d.tool_input || {};
  const type = String(input.subagent_type || "");
  if ((type && !agentIs(type, "general-purpose")) || OWN_MODEL.some((name) => agentIs(type, name))) return;
  const prompt = String(input.prompt || "");
  const light = LIGHT.test(prompt) && !HEAVY.test(prompt);
  const session = d.session_id || "?";
  if (input.model) return;
  if (light) {
    logRun("model-route", { action: "haiku", type: input.subagent_type || "" });
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...input, model: "haiku" } } }));
    return;
  }
  if (!shouldDeny(session)) { logRun("model-route", { action: "gave-up", type }); return; }
  logRun("model-route", { action: "deny", type });
  deny("Set model on the subagent, otherwise it runs on the expensive session model: haiku for search, reading, comparison and counting; " +
    "sonnet for implementation from a ready specification with tests and for research; opus for review, architecture and finding an unknown cause. Repeat the call with model.");
}

function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
}

function shouldDeny(session) {
  let state = {};
  try { state = JSON.parse(readFileSync(STATE, "utf8")) || {}; } catch { state = {}; }
  const now = Date.now();
  const recent = (state[session] || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= GIVE_UP) return false;
  state[session] = [...recent, now];
  const keep = Object.entries(state).sort((a, b) => Math.max(...b[1]) - Math.max(...a[1])).slice(0, 300);
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(Object.fromEntries(keep)) + "\n");
  return true;
}
