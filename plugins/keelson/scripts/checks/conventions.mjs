import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addedLines } from "../lib/checks.mjs";
import { apiFindings, headJson, loadConventions, rawHits, termHits, touchedSince } from "../lib/conventions.mjs";
import { matchesAny } from "../lib/glob.mjs";

export function run({ root, changedAll = [], startedAt = 0 }) {
  const conv = loadConventions(root);
  if (!conv) return [];
  if (conv.broken) return [{ class: "other", file: ".agent/conventions.json", message: ".agent/conventions.json is not valid JSON, the vocabulary is not checked" }];
  const findings = [];
  const termPaths = conv.terms_paths || ["**"];
  const uiPaths = conv.ui?.paths || [];
  for (const rel of changedAll) {
    if (rel === ".agent/conventions.json") continue;
    const inTerms = matchesAny(rel, termPaths);
    const inUi = conv.ui?.no_raw && matchesAny(rel, uiPaths);
    if (!inTerms && !inUi) continue;
    const lines = addedLines(root, rel);
    if (inTerms) findings.push(...termHits(conv, rel, lines));
    if (inUi) findings.push(...rawHits(rel, lines));
  }
  const spec = conv.api?.openapi;
  if (spec && (changedAll.includes(spec) || touchedSince(root, spec, startedAt))) {
    let doc = null;
    try { doc = JSON.parse(readFileSync(join(root, spec), "utf8")); } catch { doc = null; }
    if (doc) {
      const before = apiFindings(conv, headJson(root, spec) || {});
      for (const [key, f] of apiFindings(conv, doc)) if (!before.has(key)) findings.push(f);
    }
  }
  return findings;
}
