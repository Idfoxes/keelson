#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { repoKey } from "./lib/repo.mjs";
import { redact } from "./lib/redact.mjs";
import { lastTurn } from "./lib/transcript.mjs";
import { normalizeInput, sessionKey } from "./lib/codex.mjs";
import { recordBoard } from "./lib/board.mjs";

const FILE = join(homedir(), ".agent", "turns.jsonl");
const TAIL_CHARS = 200;

try {
  record();
} catch {
  process.exit(0);
}
process.exit(0);

function record() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  d = normalizeInput(d);
  const session = sessionKey(d.session_id);
  if (!session || !d.transcript_path) return;

  const { ctx, text } = lastTurn(d.transcript_path);
  const tail = text ? redact(text).text.slice(-TAIL_CHARS) : "";
  const project = d.cwd ? repoKey(d.cwd) : "-";
  mkdirSync(dirname(FILE), { recursive: true });
  appendFileSync(FILE, JSON.stringify({
    ts: new Date().toISOString(),
    session,
    project,
    ctx,
    tail,
  }) + "\n", "utf8");

  try { recordBoard({ session, id: String(d.session_id || ""), cwd: d.cwd, project, ctx, text }); } catch {}
}
