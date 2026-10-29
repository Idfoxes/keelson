import { addedLines } from "../lib/checks.mjs";
import { matchesAny } from "../lib/glob.mjs";
import { logRun } from "../lib/hook-log.mjs";
import { canonical } from "../lib/paths.mjs";
import { repoKey } from "../lib/repo.mjs";
import { MAX_LINE, loadRules } from "../lib/rules.mjs";

export function run({ root, changedAll = [], trusted = true }) {
  const rules = loadRules(root).filter((r) => r.mode !== "off").map((r) => (trusted ? r : { ...r, mode: "shadow" }));
  if (!rules.length) return [];
  const findings = [];
  for (const rel of changedAll) {
    const active = rules.filter((r) => matchesAny(rel, r.paths));
    if (!active.length) continue;
    const lines = addedLines(root, rel);
    for (const rule of active) {
      const hit = lines.find((l) => l.text.length <= MAX_LINE && rule.re.test(l.text));
      if (!hit) continue;
      if (rule.mode === "shadow") {
        logRun("rule-shadow", { repo: repoKey(root), root: canonical(root), rule: rule.id, file: rel, line: hit.line, text: hit.text.trim().slice(0, 200) });
        continue;
      }
      findings.push({ class: rule.class, file: `${rel}:${hit.line}`, message: `${rel}:${hit.line}: ${rule.message} [rule ${rule.id}]` });
    }
  }
  return findings;
}
