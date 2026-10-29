import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function logRun(hook, data) {
  try {
    const dir = join(homedir(), ".agent");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "hook-runs.jsonl"), JSON.stringify({ ts: new Date().toISOString(), hook, ...data }) + "\n");
  } catch {
    return;
  }
}
