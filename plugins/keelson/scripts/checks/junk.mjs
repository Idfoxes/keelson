import { gitStatus } from "../lib/checks.mjs";
import { statSync } from "node:fs";
import { join } from "node:path";

const JUNK = [/\.(bak|orig|rej|swp|tmp|log)$/i, /~$/, /(^|\/)\.DS_Store$/, /(^|\/)(tmp_|scratch|debug_|untitled)[^/]*$/i];
const ROOT_KEEP = /^(README|AGENTS|CLAUDE|GEMINI|CHANGELOG|CHANGES|CONTRIBUTING|LICENSE|NOTICE|SECURITY|CODEOWNERS|requirements[\w.-]*)(\.\w+)?$/i;
const ROOT_REPORT = /^[^/]+\.(md|txt|csv|html|png|jpg)$/i;
const BIG_BYTES = 5 * 1024 * 1024;

export function run({ root, startedAt, status }) {
  const out = typeof status === "string" ? status : gitStatus(root);
  const findings = [];
  for (const line of out.split("\n")) {
    if (!line.startsWith("?? ")) continue;
    const rel = line.slice(3).replace(/^"|"$/g, "");
    let st;
    try { st = statSync(join(root, rel)); } catch { continue; }
    if (startedAt && st.mtimeMs < startedAt) continue;
    const reason = JUNK.some((re) => re.test(rel)) ? "temporary file"
      : ROOT_REPORT.test(rel) && !ROOT_KEEP.test(rel) ? "report or draft in the repository root"
      : st.size > BIG_BYTES ? `file of ${Math.round(st.size / 1048576)} MB` : "";
    if (reason) findings.push({ class: "junk", file: rel, message: `${reason}: ${rel}` });
  }
  return findings;
}
