import { execFileSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";

export function repoKey(cwd) {
  const dir = cwd || process.cwd();
  try {
    const common = execFileSync("git", ["-C", dir, "rev-parse", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
    if (common) return basename(dirname(resolve(dir, common)));
  } catch {
    return basename(dir).replace(/-[0-9a-f]{6}$/, "");
  }
  return basename(dir).replace(/-[0-9a-f]{6}$/, "");
}

export function neutralBranch(name) {
  const generated = /^claude\//i.test(name);
  let base = name.replace(/^claude\//i, "");
  if (generated) base = base.replace(/-[0-9a-f]{6}$/, "");
  base = base.replace(/claude/gi, "").replace(/[-_/]{2,}/g, "-").replace(/^[-_/]+|[-_/]+$/g, "");
  return base || "task-" + new Date().toISOString().slice(0, 10);
}
