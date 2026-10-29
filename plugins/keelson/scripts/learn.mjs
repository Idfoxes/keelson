#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConventions } from "./lib/conventions.mjs";
import { readAll, select } from "./lib/findings.mjs";

const RECIPES = {
  terms: "glossary: 'canonical: forbidden synonyms' in .agent/conventions.json, terms section",
  contract: "api rule in .agent/conventions.json (error schema, page shape, enum) or a contract test on OpenAPI",
  "raw-value": "ui.no_raw and ui.paths in .agent/conventions.json, a formatting helper instead of the raw value",
  "single-source": "one calculation function and a test that both views take the number from it",
  "ui-state": "a component state test for every status",
  layout: "a screenshot e2e test for this screen",
  security: "a gate rule: secrets and internal fields must not reach responses or input fields",
  duplicate: "check that reuse-scout runs before writing; extract the duplicate",
  "dead-code": "knip or vulture in turn_checks",
  junk: "a line in .gitignore or drafts in .agent/scratch",
  lint: "a lesson via lessons.mjs add: which linter rule the agent keeps breaking",
  types: "a lesson: which type the agent keeps confusing",
  tests: "a lesson: which tests the agent breaks and why",
  "test-gap": "a scenario in the unit acceptance criteria and a test for it",
  perf: "a measurement and a threshold in checks",
  other: "review by hand",
};
const COVERED = {
  terms: (c) => Object.keys(c.terms || {}).length > 0,
  contract: (c) => Boolean(c.api),
  "raw-value": (c) => Boolean(c.ui?.no_raw),
};

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i < 0 || argv[i + 1] === undefined ? d : argv[i + 1]; };
if (argv[0] !== "suggest") {
  console.log("learn.mjs suggest [--days 14] [--min 3] [--repo R] [--json]");
  process.exit(argv[0] ? 2 : 0);
}
const items = suggest(select(readAll(), { repo: opt("repo"), days: Number(opt("days", 14)) }), Number(opt("min", 3)));
if (argv.includes("--json")) console.log(JSON.stringify(items));
else if (!items.length) console.log("No candidates: no class has repeated the required number of times without a rule.");
else {
  for (const it of items) console.log(`${it.repo} ${it.class} ×${it.count}: ${it.kind === "leak" ? "a rule exists but misses it, refine it: " : ""}${it.recipe}\n  ${it.examples.join("\n  ")}`);
  console.log("Put the regex rule in the repository's .agent/rules/<id>.json in shadow mode and check it against history: node rules.mjs backtest <id> --root <repository>.");
}

function suggest(rows, min) {
  const groups = new Map();
  for (const r of rows.filter((x) => x.kind !== "scope")) {
    const key = `${r.repo}\t${r.class}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = [];
  for (const [key, list] of groups) {
    const [repo, cls] = key.split("\t");
    const root = list.find((r) => r.root)?.root;
    const conv = root ? loadConventions(root) : null;
    const ruleSince = conv && COVERED[cls]?.(conv) ? statSync(join(root, ".agent", "conventions.json")).mtimeMs : null;
    const relevant = ruleSince === null ? list : list.filter((r) => Date.parse(r.ts) >= ruleSince);
    if (relevant.length < min) continue;
    out.push({
      repo, class: cls, count: relevant.length, kind: ruleSince === null ? "new" : "leak", recipe: RECIPES[cls] || RECIPES.other,
      examples: relevant.slice(-3).map((r) => `${r.file || ""} ${r.evidence || ""}`.trim()),
    });
  }
  return out.sort((a, b) => b.count - a.count);
}
