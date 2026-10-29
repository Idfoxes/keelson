#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { gitTop } from "./lib/checks.mjs";
import { finalTurn, toolCalls } from "./lib/evidence.mjs";
import { record } from "./lib/findings.mjs";
import { logRun } from "./lib/hook-log.mjs";
import { repoKey } from "./lib/repo.mjs";
import { ADMITS_UNVERIFIED } from "./lib/turn.mjs";
import { normalizeInput } from "./lib/codex.mjs";

const STATE = join(homedir(), ".agent", "claims-guard.json");
const B = "(?<![\\p{L}\\p{N}_])";
const E = "(?![\\p{L}\\p{N}_])";
const word = (alts) => new RegExp(`${B}(${alts})${E}`, "iu");
const TEST_CMD = /(^|[\s;&|(/])(pytest|vitest|jest|mocha|go test|cargo test|node --test|playwright test|mvnw? [^\n]*\b(test|verify)\b|gradlew? [^\n]*\b(test|check)\b|(npm|pnpm|yarn|bun)( run)? test|make (test|check)|test\.sh|unittest|tox|nox|deno test|phpunit|rspec)/;
const BUILD_CMD = /(^|[\s;&|(/])((npm|pnpm|yarn|bun)( run)? (build|lint|typecheck|check)|tsc|mypy|ruff|eslint|mvnw?|gradlew?|make|cargo (build|check|clippy)|go (build|vet)|lint-imports|pyright)(\s|$)/;
const SHIP_CMD = /\b(git(\s+-[Cc]\s+\S+)*\s+push|kubectl (apply|rollout|set image|patch|scale)|helm (upgrade|install)|terraform apply)\b|(^|\s)\S*deploy\S*(\s|$)/;
const CLAIMS = [
  { kind: "tests", re: new RegExp(`${word("тесты|тест|tests|test").source}[^.\\n]{0,50}${word("прошли|прошёл|прошел|проходят|зелёные|зеленые|passed|passing|pass|green").source}|\\b\\d+ passed\\b`, "iu"), need: (e) => e.afterEdit.filter((c) => c.name === "Bash" && TEST_CMD.test(c.command)), what: "test run after the last code change" },
  { kind: "build or lint", re: new RegExp(`${word("сборка|build|линтер|lint|mypy|типы|typecheck|tsc").source}[^.\\n]{0,40}${word("прошла|прошёл|прошел|зелёная|зеленая|чистая|чисто|без ошибок|no errors|passed|passes|succeeded|clean|green").source}`, "iu"), need: (e) => e.afterEdit.filter((c) => c.name === "Bash" && BUILD_CMD.test(c.command)), what: "build, lint or type-check run after the last code change" },
  { kind: "deploy or push", re: word("задеплоил|выкатил|раскатил|запушил|deployed|pushed|rolled out"), need: (e) => e.session.filter((c) => c.name === "Bash" && SHIP_CMD.test(c.command)), what: "git push, kubectl or deploy in the session" },
];
const NEGATIVE = new RegExp(`${B}(?:не|not)\\s+(прош|прох|собрал|запуш|задепло|выкат|pass|build|built|push|deploy)|n't\\s+(?:pass|build|push|deploy)|${word("fail|failed|failing|упал|упали|падают|красные|broken|сломан|сломана").source}`, "iu");
const HONEST = /расч[её]т|оценк|примерно|около|ожида|прогноз|estimate|approx|roughly|expected|forecast|projected/i;
const READ_VERB = word("прочитал|прочёл|просмотрел|изучил|проверил|посмотрел|сверил|read|reviewed|checked|inspected");
const PATH = /(?:[\w.-]+\/)+[\w-]+\.[A-Za-z]{1,6}\b/g;
const MEASURE = word("быстрее|медленнее|скорость|скорости|ускорил|ускорилось|ускорение|замедлил|throughput|latency|задержка|задержку|p95|p99|вырос|выросла|выросло|упал|упала|сократил|сократилось|снизил|снизилось|faster|slower|speed|sped up|speedup|grew|increased|decreased|dropped|reduced");
const UNIT_NUMBER = /(\d+(?:[.,]\d+)?)\s?(?:МБ\/с|MB\/s|ГБ\/с|GB\/s|ГБ|GB|ТБ|TB|МБ|MB|ms|мс|сек|sec|%|rps|req\/s|RPS|мин|min)(?![\p{L}])/gu;

try {
  main();
} catch {
  process.exit(0);
}
process.exit(0);

function main() {
  let d = {};
  try { d = JSON.parse(readFileSync(0, "utf8")) || {}; } catch { return; }
  d = normalizeInput(d);
  const ft = finalTurn(d.transcript_path);
  if (!ft.text) return;
  const sentences = ft.text.replace(/```[\s\S]*?```/g, " ").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
    .filter((s) => !ADMITS_UNVERIFIED.test(s));
  const claimed = CLAIMS.map((c) => ({ ...c, said: sentences.find((s) => c.re.test(s) && !NEGATIVE.test(s)) })).filter((c) => c.said);
  const reads = sentences.filter((s) => READ_VERB.test(s) && (s.match(PATH) || []).length);
  const measures = sentences.filter((s) => MEASURE.test(s) && !HONEST.test(s) && (s.match(UNIT_NUMBER) || []).length);
  if (!claimed.length && !reads.length && !measures.length) return;
  const e = toolCalls(d.transcript_path, ft);
  const unsupported = [];
  for (const claim of claimed) {
    const calls = claim.need(e);
    if (!calls.length) unsupported.push(`“${short(claim.said)}”: no ${claim.what}`);
    else if (calls.every((c) => c.ok === false)) unsupported.push(`“${short(claim.said)}”: every such run ended with an error`);
  }
  if (reads.length) {
    const seen = e.session.map((c) => `${c.path} ${c.command} ${c.input?.pattern || ""} ${c.output.slice(0, 4000)}`).join("\n");
    for (const s of reads) {
      const missing = [...new Set(s.match(PATH))].filter((p) => !seen.includes(basename(p)));
      if (missing.length) unsupported.push(`“${short(s)}”: not opened in the session: ${missing.slice(0, 3).join(", ")}`);
    }
  }
  if (measures.length) {
    const outputs = e.session.map((c) => c.output).join("\n");
    for (const s of measures) {
      const numbers = [...s.matchAll(UNIT_NUMBER)].map((m) => m[1]).filter((n) => !outputs.includes(n) && !outputs.includes(n.replace(",", ".")));
      if (numbers.length) unsupported.push(`“${short(s)}”: the numbers ${numbers.slice(0, 3).join(", ")} do not appear in any command output of the session`);
    }
  }
  logRun("claims-guard", { claims: unsupported.length, checked: claimed.length + reads.length + measures.length });
  if (!unsupported.length) return;
  if (!firstTime(d.session_id || "?", ft.key, d.stop_hook_active === true)) return;
  const root = gitTop(d.cwd || process.cwd());
  if (root) record(unsupported.map((u) => ({ repo: repoKey(root), root, source: "gate", class: "claim", severity: "medium", evidence: u })));
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `Claims in the reply are not backed by the action log:\n${unsupported.map((u) => "• " + u).join("\n")}\n` +
      `Confirm now (run it, open it, measure it) or rewrite honestly: “not verified”, “estimate from X and Y”. Invent nothing.`,
  }));
}

function short(s) {
  return s.length > 90 ? s.slice(0, 87) + "…" : s;
}

function firstTime(session, key, continuing) {
  let state = {};
  try { state = JSON.parse(readFileSync(STATE, "utf8")) || {}; } catch { state = {}; }
  const prev = state[session];
  if (prev && (prev.key === key || continuing)) return false;
  state[session] = { key, at: new Date().toISOString() };
  const keep = Object.entries(state).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 300);
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(Object.fromEntries(keep)) + "\n");
  return true;
}
