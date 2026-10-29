#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { signature, isMachineTurn } from "./lib/text.mjs";
import { repoKey } from "./lib/repo.mjs";
import { redact } from "./lib/redact.mjs";

const MAX_TEXT = 400;

try {
  main();
} catch {
  process.exit(0);
}
process.exit(0);

function main() {
  const raw = readStdin();
  if (!raw) return;
  let d = {};
  try { d = JSON.parse(raw) || {}; } catch { return; }

  const prompt = typeof d.prompt === "string" ? d.prompt : "";
  if (!prompt.trim()) return;
  if (isMachineTurn(prompt)) return;

  const { text, hits } = redact(prompt);
  const entry = {
    ts: new Date().toISOString(),
    repo: base(d.cwd) || "-",
    project: d.cwd ? repoKey(d.cwd) : "-",
    session: (d.session_id || "").slice(0, 8),
    chars: prompt.length,
    key: signature(text),
    text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "…" : text,
  };
  if (hits.length) entry.redacted = hits;

  const dir = join(homedir(), ".agent", "journal");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, new Date().toISOString().slice(0, 7) + ".jsonl");
  appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
}

function base(p) { return typeof p === "string" ? p.split("/").filter(Boolean).pop() : ""; }

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}
