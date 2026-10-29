import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

export const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|(^|\/)(test_[^/]+\.py|[^/]+_test\.(py|go)|[^/]+\.(test|spec)\.[jt]sx?|[^/]+Test\.(java|kt)|conftest\.py)$/;
const LIMIT = 30;
const MAX_SCAN = 5000;
const MAX_BYTES = 512 * 1024;
const JS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"];
const JVM_EXT = [".java", ".kt"];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function needle(rel) {
  const ext = extname(rel);
  const stem = basename(rel, ext);
  if (stem === "__init__" || stem === "index") return null;
  const name = escape(stem);
  const module = `['"][^'"]*/${name}(?:\\.[a-z]+)?['"]`;
  if (ext === ".py") return `(?:from|import)\\s+[\\w.]*\\b${name}\\b`;
  if (JS_EXT.includes(ext)) return `from\\s+${module}|(?:require|import)\\(\\s*${module}\\s*\\)`;
  if (JVM_EXT.includes(ext)) return `\\b${name}\\b`;
  return null;
}

function testFiles(root) {
  try {
    return execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, maxBuffer: 64 * 1024 * 1024 })
      .split("\0").filter((f) => f && TEST_FILE.test(f));
  } catch {
    return [];
  }
}

function read(path) {
  try {
    return statSync(path).size <= MAX_BYTES ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

export function affectedTests(root, changed) {
  const out = new Set(changed.filter((f) => TEST_FILE.test(f)));
  const patterns = changed.filter((f) => !TEST_FILE.test(f)).map(needle).filter(Boolean);
  if (patterns.length) {
    const imports = new RegExp(patterns.join("|"));
    for (const f of [...new Set(testFiles(root))].slice(0, MAX_SCAN)) if (!out.has(f) && imports.test(read(join(root, f)))) out.add(f);
  }
  return [...out].sort().slice(0, LIMIT);
}
