#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const CODEX_HOOKS = [
  ["UserPromptSubmit", "journal.mjs"],
  ["UserPromptSubmit", "destructive-guard.mjs", "--approve"],
  ["PreToolUse", "destructive-guard.mjs", "--codex"],
  ["Stop", "quality-gate.mjs", null, 90],
  ["Stop", "claims-guard.mjs"],
  ["Stop", "stop-evidence-guard.mjs"],
  ["Stop", "turn-log.mjs"],
  ["Stop", "wake-guard.mjs"],
  ["SessionStart", "codex-probe.mjs"],
  ["PreToolUse", "codex-probe.mjs"],
  ["PostToolUse", "codex-probe.mjs"],
  ["Stop", "codex-probe.mjs"],
];

export function commandOf(script, args, scripts = HERE) {
  return `node ${join(scripts, script)}${args ? " " + args : ""}`;
}

export function mergeCodexHooks(config, scripts = HERE) {
  const cfg = config && typeof config === "object" ? structuredClone(config) : {};
  cfg.hooks = cfg.hooks && typeof cfg.hooks === "object" ? cfg.hooks : {};
  const wanted = CODEX_HOOKS.map(([event, script, args, timeout]) => ({ event, command: commandOf(script, args, scripts), timeout }));
  const ours = (command) => String(command || "").startsWith(`node ${scripts}/`);
  for (const [event, groups] of Object.entries(cfg.hooks)) {
    if (!Array.isArray(groups)) continue;
    cfg.hooks[event] = groups
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !ours(h.command) || wanted.some((w) => w.event === event && w.command === h.command)) }))
      .filter((g) => g.hooks.length);
  }
  for (const w of wanted) {
    const groups = cfg.hooks[w.event] = cfg.hooks[w.event] || [];
    if (groups.some((g) => (g.hooks || []).some((h) => h.command === w.command))) continue;
    groups.push({ hooks: [{ type: "command", command: w.command, ...(w.timeout ? { timeout: w.timeout } : {}) }] });
  }
  return cfg;
}

export function removeCodexHooks(config, scripts = HERE) {
  const cfg = config && typeof config === "object" ? structuredClone(config) : {};
  if (!cfg.hooks || typeof cfg.hooks !== "object") return cfg;
  const ours = (command) => String(command || "").startsWith(`node ${scripts}/`);
  for (const [event, groups] of Object.entries(cfg.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !ours(h.command)) }))
      .filter((g) => g.hooks.length);
    if (kept.length) cfg.hooks[event] = kept;
    else delete cfg.hooks[event];
  }
  return cfg;
}

function main() {
  const remove = process.argv[2] === "--remove";
  const file = remove ? process.argv[3] : process.argv[2];
  if (!file) {
    console.error("Usage: codex-hooks.mjs [--remove] <path to ~/.codex/hooks.json>");
    process.exit(2);
  }
  let raw = "";
  let cfg = {};
  if (existsSync(file)) {
    raw = readFileSync(file, "utf8");
    try { cfg = JSON.parse(raw) || {}; } catch {
      console.log(`SKIPPED: ${file} is not JSON, Codex hooks are not connected`);
      return;
    }
  }
  if (remove && !raw) {
    console.log("OK: no Codex hooks, nothing to remove");
    return;
  }
  const next = JSON.stringify(remove ? removeCodexHooks(cfg) : mergeCodexHooks(cfg), null, 2) + "\n";
  if (raw && JSON.stringify(JSON.parse(raw)) === JSON.stringify(JSON.parse(next))) {
    console.log(remove ? "OK: none of our hooks are in Codex" : "OK: Codex hooks are already connected");
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  if (raw) writeFileSync(file + ".bak", raw);
  writeFileSync(file, next);
  if (remove) {
    console.log(`REMOVED: our hooks removed from ${file}`);
    return;
  }
  console.log(`SYNCED: Codex hooks -> ${file}. Codex will ask you to trust the new hooks: approve them, or they will not run`);
}

const isMain = () => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
};

if (isMain()) main();
