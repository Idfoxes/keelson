#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STOP_TOKENS, signaled } from "./lib/guard-state.mjs";
import { logRun } from "./lib/hook-log.mjs";
import { lastTurn } from "./lib/transcript.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.env.KEELSON_STOP_DIR || HERE;
const CHECKS = process.env.KEELSON_STOP_CHECKS
  ? process.env.KEELSON_STOP_CHECKS.split(",").map((s) => s.trim()).filter(Boolean)
  : ["stop-evidence-guard.mjs", "claims-guard.mjs", "review-guard.mjs", "wake-guard.mjs", "push-first-guard.mjs", "quality-gate.mjs"];
const GATE_MS = 90000;
const CHECK_MS = 15000;
const REASON_CHARS = 120;
const FORCED_MS = Number(process.env.KEELSON_STOP_TIMEOUT_MS || 0);

try {
  await main();
} catch {
  process.exit(0);
}
process.exit(0);

async function main() {
  const started = Date.now();
  const raw = readFileSync(0, "utf8");
  let input = {};
  try { input = JSON.parse(raw) || {}; } catch { return; }
  const session = String(input.session_id || "");
  const short = session.slice(0, 8);

  if (session && signaled(session) && lastTurn(input.transcript_path).ctx >= STOP_TOKENS) {
    logRun("stop-dispatch", { session: short, checks: {}, blocked: 0, ms: Date.now() - started, suppressed: true, outcome: "suppressed" });
    return;
  }

  const scripts = CHECKS.filter((name) => existsSync(join(DIR, name)));
  const results = await Promise.all(scripts.map((name) => runCheck(join(DIR, name), nameOf(name), raw)));

  const blocks = results.filter((r) => r.status === "block");
  const extra = mergeExtra(results.map((r) => r.extra));
  logRun("stop-dispatch", {
    session: short,
    checks: Object.fromEntries(results.map((r) => [r.name, r.status])),
    blocked: blocks.length,
    ...(blocks.length ? { reasons: Object.fromEntries(blocks.map((b) => [b.name, b.reason.split("\n")[0].slice(0, REASON_CHARS)])) } : {}),
    ms: Date.now() - started,
    suppressed: false,
    outcome: blocks.length ? "block" : "pass",
  });

  let payload = null;
  if (blocks.length === 1) payload = { decision: "block", reason: blocks[0].reason, ...extra };
  else if (blocks.length > 1) {
    payload = {
      decision: "block",
      reason: `Findings at turn end: ${blocks.length}\n` + blocks.map((b, i) => `${i + 1}. ${b.reason}`).join("\n"),
      ...extra,
    };
  } else if (Object.keys(extra).length) payload = extra;
  if (payload) process.stdout.write(JSON.stringify(payload));
}

function nameOf(file) {
  return basename(file, extname(file));
}

function runCheck(file, name, input) {
  const ms = FORCED_MS || (name === "quality-gate" ? GATE_MS : CHECK_MS);
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let done = false;
    let timer = null;
    let child = null;
    const finish = (verdict) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ name, ...verdict });
    };
    try {
      child = spawn(process.execPath, [file], { stdio: ["pipe", "pipe", "pipe"], detached: true, env: process.env });
    } catch {
      finish({ status: "error" });
      return;
    }
    timer = setTimeout(() => {
      kill(child);
      finish({ status: "timeout" });
    }, ms);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.stdin.on("error", () => {});
    child.on("error", () => finish({ status: "error" }));
    child.on("close", (code) => finish(verdict(code, out, err, name)));
    child.stdin.end(input);
  });
}

function kill(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { return; }
  }
}

function verdict(code, out, err, name) {
  const fallback = `The ${name} check stopped the turn without an explanation.`;
  if (code === 2) return { status: "block", reason: err.trim() || fallback };
  if (code !== 0) return { status: "error" };
  const text = out.trim();
  if (!text) return { status: "pass" };
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { status: "error" }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "error" };
  const { decision, reason, ...extra } = parsed;
  if (decision === "block") return { status: "block", reason: String(reason || "").trim() || fallback, extra };
  return { status: "pass", extra };
}

function mergeExtra(list) {
  const merged = {};
  for (const extra of list) {
    for (const [key, value] of Object.entries(extra || {})) {
      if (key === "systemMessage" && typeof value === "string") merged[key] = merged[key] ? merged[key] + "\n" + value : value;
      else if (key === "hookSpecificOutput" && value && typeof value === "object") merged[key] = { ...merged[key], ...value };
      else if (!(key in merged)) merged[key] = value;
    }
  }
  return merged;
}
