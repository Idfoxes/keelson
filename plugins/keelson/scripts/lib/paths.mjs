import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function canonical(path) {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(canonical(parent), basename(path));
  }
}
