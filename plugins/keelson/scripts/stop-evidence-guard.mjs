#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { ADMITS_UNVERIFIED, DONE_CLAIM, EDIT_TOOLS, currentTurn } from "./lib/turn.mjs";
import { normalizeInput } from "./lib/codex.mjs";

const CHECK_TOOLS = new Set(["Bash"]);
const PROSE_FILE = /\.(md|txt|rst)$/i;
const GIT_PUSH = /(^|[;&|]\s*|\s)git(\s+-C\s+\S+)?\s+push\b/;
const GIT_COMMIT = /(^|[;&|]\s*|\s)git(\s+-C\s+\S+)?\s+(commit|merge)\b/;
const HAS_LINK = /https?:\/\/\S+/;
const HAS_HASH = /\b[0-9a-f]{7,40}\b/;
const MR_LINK = /merge_requests|\/pull\/|\/compare\//;
const MAIN_BRANCH = /^(main|master|develop|HEAD)$/;

try {
  main();
} catch {
  process.exit(0);
}
process.exit(0);

function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  input = normalizeInput(input);
  if (input.stop_hook_active) return;

  const turn = currentTurn(input.transcript_path);
  const missing = missingReference(turn);
  if (missing) {
    process.stdout.write(JSON.stringify({ decision: "block", reason: missing }));
    return;
  }
  if (!DONE_CLAIM.test(turn.text) || ADMITS_UNVERIFIED.test(turn.text)) return;

  const unchecked = editsAfterLastCheck(turn.tools).filter((path) => !PROSE_FILE.test(path));
  if (!unchecked.length) return;

  const files = [...new Set(unchecked.map((p) => basename(p)))].slice(0, 3).join(", ");
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `The reply says the work is done, but no check ran after the last change (${files}). ` +
      `Run a test, a build or a measurement and report the result. If it cannot be checked, say plainly that it is not verified and why.`,
  }));
}

function missingReference(turn) {
  const commands = turn.tools.filter((t) => t.name === "Bash").map((t) => t.command);
  const pushes = commands.filter((c) => GIT_PUSH.test(c));
  if (pushes.length && !HAS_LINK.test(turn.text)) {
    return "This turn included a git push, but the reply has no link. Give a link to the commit, or to the pull or merge request if one exists " +
      "(the output of git push shows it for a new branch), otherwise the user asks for it in a separate message.";
  }
  const branch = pushes.map(pushedBranch).find(Boolean) || "";
  if (branch && !MR_LINK.test(turn.text)) {
    return `This turn pushed branch ${branch}, but the reply has no link to its pull or merge request. Give that link, or say plainly that none exists ` +
      "(the output of git push shows it for a new branch): the user does not merge from a commit or pipeline link and asks for the request in a separate message.";
  }
  if (commands.some((c) => GIT_COMMIT.test(c)) && !HAS_LINK.test(turn.text) && !HAS_HASH.test(turn.text)) {
    return "This turn made a commit, but the reply has neither a hash nor a link. Name the commit: the short hash and one line on what it contains.";
  }
  return "";
}

function pushedBranch(command) {
  const m = command.match(/git(?:\s+-C\s+\S+)?\s+push\b([^;&|]*)/);
  if (!m || /--tags|--delete|(^|\s)-d(\s|$)/.test(m[1])) return "";
  const args = m[1].trim().split(/\s+/).filter((a) => a && !a.startsWith("-"));
  if (args.length < 2 || /^[./~]/.test(args[0])) return "";
  const ref = args[1].replace(/^\+/, "").split(":").pop().replace(/^refs\/heads\//, "");
  return MAIN_BRANCH.test(ref) ? "" : ref;
}

function editsAfterLastCheck(tools) {
  let lastCheck = -1;
  tools.forEach((t, i) => { if (CHECK_TOOLS.has(t.name)) lastCheck = i; });
  return tools.slice(lastCheck + 1).filter((t) => EDIT_TOOLS.has(t.name)).map((t) => t.path);
}
