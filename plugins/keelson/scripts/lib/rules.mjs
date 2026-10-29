import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MODES = ["shadow", "on", "off"];
export const MAX_LINE = 500;
const NESTED = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*[+*{]/;

export function rulesDir(root) {
  return join(root, ".agent", "rules");
}

export function loadRules(root) {
  const dir = rulesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (!r.id || !r.pattern || NESTED.test(r.pattern) || r.pattern.length > 300) return [];
      return [{ mode: "shadow", paths: ["**"], class: "other", ...r, re: new RegExp(r.pattern, String(r.flags || "u").replace(/[^imsu]/g, "")) }];
    } catch {
      return [];
    }
  });
}

export function setMode(root, id, mode) {
  const file = join(rulesDir(root), id + ".json");
  if (!existsSync(file) || !MODES.includes(mode)) return false;
  const r = JSON.parse(readFileSync(file, "utf8"));
  r.mode = mode;
  r[`${mode}_at`] = new Date().toISOString();
  writeFileSync(file, JSON.stringify(r, null, 2) + "\n");
  return true;
}
