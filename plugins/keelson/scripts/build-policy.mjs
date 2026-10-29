#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RULES_D = process.env.KEELSON_RULES_D || join(ROOT, "global", "rules.d");
const BASE = join(ROOT, "global", "AGENTS.md");

const parts = existsSync(BASE) ? [readFileSync(BASE, "utf8").trimEnd()] : [];
if (existsSync(RULES_D)) {
  for (const name of readdirSync(RULES_D).filter((n) => n.endsWith(".md")).sort()) {
    parts.push(readFileSync(join(RULES_D, name), "utf8").trim());
  }
}
const text = parts.join("\n\n").replaceAll("${CLAUDE_PLUGIN_ROOT}", ROOT);
if (process.argv.includes("--hook")) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
} else {
  process.stdout.write(text + "\n");
}
