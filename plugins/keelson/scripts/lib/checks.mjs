import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { affectedTests } from "./affected.mjs";
import { logRun } from "./hook-log.mjs";
import { canonical } from "./paths.mjs";
import { repoKey } from "./repo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CHECKS_DIR = process.env.KEELSON_CHECKS_D || join(HERE, "..", "checks");
export const CODE_EXT = new Set([".py", ".pyi", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".java", ".kt", ".go", ".rs", ".sh", ".sql", ".vue", ".svelte"]);
export const OUTPUT_LINES = 40;

export function gitTop(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
  } catch {
    return "";
  }
}

export function yamlList(text, key) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.trim() === key + ":" && !/^\s/.test(l));
  if (at < 0) return [];
  const out = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\S/.test(line)) break;
    const m = line.match(/^\s+-\s+(.+?)\s*$/);
    if (m) out.push(m[1].replace(/^["']|["']$/g, ""));
  }
  return out;
}

export function yamlFlag(text, key) {
  return new RegExp(`^${key}:\\s*(true|yes|on)\\s*$`, "m").test(text);
}

export function projectConfig(root) {
  const file = join(root, ".agent", "project.yaml");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  return { full: yamlList(text, "checks"), turn: yamlList(text, "turn_checks"), noComments: yamlFlag(text, "no_comments") };
}

export function gitStatus(root) {
  try {
    return execFileSync("git", ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000, maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return "";
  }
}

export function touchedInTurn(root, startedAt, status = null) {
  if (!startedAt) return [];
  const out = status === null ? gitStatus(root) : status;
  return out.split("\n").filter((l) => l.length > 3 && l[1] !== "D" && l[0] !== "D")
    .map((l) => l.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""))
    .filter((rel) => { try { return statSync(join(root, rel)).mtimeMs >= startedAt; } catch { return false; } });
}

export function changedFiles(root, tools, startedAt = 0, status = null) {
  const files = new Set(touchedInTurn(root, startedAt, status));
  const base = canonical(root);
  for (const t of tools) {
    if (!t.path) continue;
    const rel = relative(base, canonical(t.path.startsWith("/") ? t.path : join(root, t.path)));
    if (!rel.startsWith("..") && existsSync(join(root, rel))) files.add(rel);
  }
  return [...files].sort();
}

export const SCRATCH = /(^|\/)\.agent\/scratch\//;

export function changedCode(root, tools, startedAt = 0) {
  return changedFiles(root, tools, startedAt).filter((rel) => CODE_EXT.has(extname(rel)) && !SCRATCH.test(rel));
}

export function diffOf(root, rel) {
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
  const removed = new Set();
  let tracked = false;
  try { tracked = Boolean(git(["ls-files", "--error-unmatch", rel]).trim()); } catch { tracked = false; }
  if (!tracked) {
    try { return { added: readFileSync(join(root, rel), "utf8").split("\n").map((text, i) => ({ line: i + 1, text })), removed }; } catch { return { added: [], removed }; }
  }
  try {
    const added = [];
    let line = 0;
    for (const l of git(["diff", "-U0", "HEAD", "--", rel]).split("\n")) {
      const hunk = l.match(/^@@ -\S+ \+(\d+)/);
      if (hunk) { line = Number(hunk[1]); continue; }
      if (l.startsWith("+") && !l.startsWith("+++")) added.push({ line: line++, text: l.slice(1) });
      else if (l.startsWith("-") && !l.startsWith("---")) removed.add(l.slice(1).trim());
    }
    return { added, removed };
  } catch {
    return { added: [], removed };
  }
}

export function addedLines(root, rel) {
  const { added, removed } = diffOf(root, rel);
  return added.filter((l) => !removed.has(l.text.trim()));
}

const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";

export function venvOf(dir) {
  if (!dir) return "";
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => VENV.test(n));
  } catch {
    return "";
  }
  names.sort((a, b) => (a === ".venv" ? -1 : b === ".venv" ? 1 : a.localeCompare(b)));
  return names.find((n) => existsSync(join(dir, n, "pyvenv.cfg")) || existsSync(join(dir, n, "bin", "python"))) || "";
}

export function autodetect(root, changed, { trusted = true, full = [], main = "" } = {}) {
  const by = (exts) => changed.filter((f) => exts.includes(extname(f)));
  const venvs = [root, main].filter(Boolean).map((d) => venvOf(d) && join(d, venvOf(d), "bin")).filter(Boolean);
  const local = (bin) => trusted ? [venvs[0] && join(venvs[0], bin), join(root, "node_modules", ".bin", bin), venvs[1] && join(venvs[1], bin)].filter(Boolean).find(existsSync) : undefined;
  const onPath = (bin) => {
    const r = spawnSync("bash", ["-lc", `command -v ${bin}`], { encoding: "utf8", timeout: 5000 });
    const path = String(r.stdout || "").trim().split("\n").pop();
    return r.status === 0 && path.startsWith("/") ? path : null;
  };
  const pyproject = existsSync(join(root, "pyproject.toml")) ? readFileSync(join(root, "pyproject.toml"), "utf8") : "";
  const ruffConfigured = /^\[tool\.ruff/m.test(pyproject) || ["ruff.toml", ".ruff.toml"].some((f) => existsSync(join(root, f)));
  const formatConfigured = /^\[tool\.ruff\.format\]/m.test(pyproject) || full.some((c) => c.includes("ruff format"));
  const out = [];
  const py = by([".py", ".pyi"]);
  const ruff = py.length && ruffConfigured && (local("ruff") || onPath("ruff"));
  if (ruff) {
    out.push({ name: "ruff check", cmd: `${quote(ruff)} check ${py.map(quote).join(" ")}` });
    if (formatConfigured) out.push({ name: "ruff format", cmd: `${quote(ruff)} format --check ${py.map(quote).join(" ")}` });
  }
  if (py.length && !ruff) {
    const anyRuff = local("ruff") || onPath("ruff");
    const python = local("python");
    if (anyRuff) out.push({ name: "ruff critical", cmd: `${quote(anyRuff)} check --no-cache --select ${CRITICAL} ${py.map(quote).join(" ")}` });
    else if (python) out.push({ name: "python syntax", cmd: `${quote(python)} -c ${quote(SYNTAX)} ${py.map(quote).join(" ")}` });
  }
  const js = by([".ts", ".tsx", ".js", ".jsx", ".vue"]);
  const eslintConfigured = readdirSync(root).some((f) => /^(eslint\.config\.|\.eslintrc)/.test(f));
  const eslint = js.length && eslintConfigured && local("eslint");
  if (eslint) out.push({ name: "eslint", cmd: `${quote(eslint)} ${js.map(quote).join(" ")}` });
  for (const f of by([".mjs", ".cjs"])) out.push({ name: "node --check", cmd: `node --check ${quote(f)}` });
  for (const f of by([".sh"])) out.push({ name: "bash -n", cmd: `bash -n ${quote(f)}` });
  return out;
}

const CRITICAL = "E9,F63,F7,F82";
const SYNTAX = "import ast, sys\nfor f in sys.argv[1:]: ast.parse(open(f, encoding='utf-8').read(), f)";
const VENV = /^\.?venv([-_.][\w.-]+)?$/;
const TOOL = /(^|[\s;&|(])((?:\.?venv[\w.-]*\/bin|node_modules\/\.bin)\/[\w.+-]+)/g;
const TEST_RUNNER = /\{tests|(^|[\s/])(pytest|vitest|jest|mocha|mvnw|gradlew)\b|\bgo test\b|\bnpm (run )?test\b/;
const JS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"];
const PY_TEST = /(^|\/)(test_[^/]+|[^/]+_test)\.py$/;

export function mainWorktree(root) {
  try {
    const common = execFileSync("git", ["-C", root, "rev-parse", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
    const main = dirname(resolve(root, common));
    return canonical(main) === canonical(root) ? "" : main;
  } catch {
    return "";
  }
}

const VENVS_FILE = process.env.KEELSON_PYTHON_VENVS || join(HERE, "..", "..", "global", "python-venvs.json");
const SYSTEM_PYTHON = "python3";
const BARE_PYTEST = /(^|[\s;&|(])(?:python3?\s+-m\s+pytest|(?<!-m\s)pytest)(?=\s|$)/g;

export function loadVenvs(file = VENVS_FILE) {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return Object.fromEntries(Object.entries(raw).map(([repo, python]) => [repo, String(python).replace(/^~(?=\/|$)/, homedir())]));
  } catch {
    return {};
  }
}

export function resolvePython(root, { venvs = loadVenvs() } = {}) {
  const main = mainWorktree(root);
  const mapped = [root, main].map((d) => d && venvs[basename(d)]).find((p) => p && existsSync(p));
  if (mapped) return mapped;
  const own = join(root, ".venv", "bin", "python");
  return existsSync(own) ? own : SYSTEM_PYTHON;
}

function withProjectPython(cmd, root) {
  const python = resolvePython(root);
  return python === SYSTEM_PYTHON ? cmd : cmd.replace(BARE_PYTEST, (_, before) => `${before}${quote(python)} -m pytest`);
}

export function resolveTools(check, root, main = "") {
  const cd = check.cmd.match(/^cd\s+(\S+)\s*&&\s*/);
  const dir = cd ? cd[1].replace(/^'|'$/g, "") : ".";
  const missing = [];
  let borrowed = false;
  const cmd = withProjectPython(check.cmd, root).replace(TOOL, (all, before, tool) => {
    if (existsSync(join(root, dir, tool))) return all;
    const theirs = main && !tool.startsWith("node_modules/") ? join(main, dir, tool) : "";
    if (theirs && existsSync(theirs)) {
      borrowed = true;
      return before + quote(theirs);
    }
    missing.push(tool);
    return all;
  });
  if (missing.length && main) return { ...check, skip: `missing ${missing.join(", ")} in both the worktree and the main checkout` };
  if (!borrowed) return { ...check, cmd };
  const code = canonical(existsSync(join(root, dir, "src")) ? join(root, dir, "src") : join(root, dir));
  return { ...check, borrowed: true, cmd: "export KEELSON_BORROWED=1 PYTHONPATH=" + quote(code) + "${PYTHONPATH:+:$PYTHONPATH}; " + cmd };
}

function hasPytestCov(dir) {
  const lib = join(dir, venvOf(dir), "lib");
  try {
    return readdirSync(lib).some((py) => existsSync(join(lib, py, "site-packages", "pytest_cov")));
  } catch {
    return false;
  }
}

function packageDir(root, rel) {
  for (let dir = dirname(rel); ; dir = dirname(dir)) {
    if (existsSync(join(root, dir, "package.json"))) return dir;
    if (dir === "." || dir === "/") return null;
  }
}

export function defaultTests(root, changed, { trusted = true, main = "", py: runPy = true, js: runJs = true } = {}) {
  if (!trusted) return [];
  const out = [];
  const py = runPy ? changed.filter((f) => extname(f) === ".py") : [];
  const pyTests = py.length ? affectedTests(root, py).filter((f) => PY_TEST.test(f)) : [];
  const venv = [root, main].find((d) => d && venvOf(d) && existsSync(join(d, venvOf(d), "bin", "pytest")));
  const venvs = loadVenvs();
  const python = resolvePython(root, { venvs });
  const viaPython = Object.values(venvs).includes(python) || !venv;
  const runner = viaPython ? (python !== SYSTEM_PYTHON ? `${quote(python)} -m pytest` : "") : `${venvOf(venv)}/bin/pytest`;
  if (pyTests.length && runner) {
    const cov = !viaPython && hasPytestCov(venv) ? " --no-cov" : "";
    out.push({ name: "pytest affected", cmd: `${runner} -q -x -p no:cacheprovider${cov} ${pyTests.map(quote).join(" ")}; s=$?; case $s in 0|5) exit 0 ;; 2) [ -n "\${KEELSON_BORROWED:-}" ] && exit 0 ;; 3|4) exit 0 ;; esac; exit $s` });
  }
  const groups = new Map();
  for (const f of runJs ? changed.filter((f) => JS_EXT.includes(extname(f))) : []) {
    const pkg = packageDir(root, f);
    if (pkg === null) continue;
    groups.set(pkg, [...(groups.get(pkg) || []), pkg === "." ? f : f.slice(pkg.length + 1)]);
  }
  for (const [pkg, files] of groups) {
    const runner = ["vitest", "jest"].find((bin) => existsSync(join(root, pkg, "node_modules", ".bin", bin)));
    if (!runner) continue;
    const args = runner === "vitest" ? "related --run --passWithNoTests --coverage.enabled=false --exclude '**/.claude/**'" : "--findRelatedTests --passWithNoTests --coverage=false";
    out.push({ name: `${runner} related`, cmd: `${pkg === "." ? "" : `cd ${quote(pkg)} && `}node_modules/.bin/${runner} ${args} ${files.map(quote).join(" ")}` });
  }
  return out;
}

function targets(raw, changed) {
  const lang = raw.match(/^(\w+):\s+/);
  const files = lang && GROUPS[lang[1]] ? changed.filter((f) => GROUPS[lang[1]].includes(extname(f))) : changed;
  const dir = raw.match(/\{files:([^}]+)\}/);
  return dir ? files.filter((f) => f.startsWith(dir[1].replace(/\/$/, "") + "/")) : files;
}

function language(raw) {
  const lang = raw.match(/^(\w+):\s+/);
  return lang && GROUPS[lang[1]] ? lang[1] : "";
}

export function planChecks(root, changed, project, { trusted = true, log = false } = {}) {
  if (!changed.length) return [];
  const main = mainWorktree(root);
  const turn = trusted ? project.turn : [];
  const skipped = [];
  const keep = (c) => {
    if (!c.skip) return true;
    skipped.push(`${c.name}: ${c.skip}`);
    return false;
  };
  const covered = new Set();
  const fromTurn = [];
  for (const raw of turn) {
    const expanded = expand(raw, changed, root);
    if (!expanded) continue;
    const check = resolveTools(expanded, root, main);
    if (!keep(check)) continue;
    fromTurn.push(check);
    if (raw.includes("{files")) targets(raw, changed).forEach((f) => covered.add(f));
  }
  const rest = changed.filter((f) => !covered.has(f));
  const auto = (rest.length ? autodetect(root, rest, { trusted, full: project.full, main }) : []).map((c) => resolveTools(c, root, main)).filter(keep);
  const own = (group) => turn.some((c) => TEST_RUNNER.test(c) && (!language(c) || GROUPS[language(c)] === GROUPS[group]));
  const tests = defaultTests(root, changed, { trusted, main, py: !own("py"), js: !own("ts") }).map((c) => resolveTools(c, root, main)).filter(keep);
  if (log && skipped.length) logRun("quality-gate-skip", { repo: repoKey(root), worktree: Boolean(main), skipped });
  return [...fromTurn, ...auto, ...tests];
}

const GROUPS = {
  py: [".py", ".pyi"],
  ts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"],
  js: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"],
  sh: [".sh"],
  java: [".java", ".kt"],
  go: [".go"],
};

export function expand(raw, changed, root = "") {
  const lang = raw.match(/^(\w+):\s+/);
  const cmd = lang && GROUPS[lang[1]] ? raw.slice(lang[0].length) : raw;
  const files = lang && GROUPS[lang[1]] ? changed.filter((f) => GROUPS[lang[1]].includes(extname(f))) : changed;
  if (!files.length) return null;
  const tests = /\{tests(:[^}]+)?\}/.test(cmd) ? affectedTests(root, files) : [];
  let empty = false;
  const out = cmd.replace(/\{(files|tests)(?::([^}]+))?\}/g, (_, kind, dir) => {
    const pool = kind === "tests" ? tests : files;
    const list = dir ? pool.filter((f) => f.startsWith(dir.replace(/\/$/, "") + "/")).map((f) => f.slice(dir.replace(/\/$/, "").length + 1)) : pool;
    if (!list.length) empty = true;
    return list.map(quote).join(" ");
  });
  if (empty) return null;
  const words = cmd.replace(/^cd\s+\S+\s*&&\s*/, "").split(/\s+/).filter((w) => !w.includes("{"));
  return { name: words.slice(0, 2).join(" ").replace(/^\S*\//, ""), cmd: out };
}

export function runCommand(cmd, cwd, timeoutMs) {
  const started = Date.now();
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8", timeout: Math.max(1000, timeoutMs), maxBuffer: 8 * 1024 * 1024 });
  const timedOut = r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM";
  const output = `${r.stdout || ""}${r.stderr || ""}`.trim();
  return { ok: r.status === 0 && !timedOut, timedOut, output, ms: Date.now() - started };
}

export async function builtinChecks(ctx) {
  if (!existsSync(CHECKS_DIR)) return [];
  const found = [];
  for (const name of readdirSync(CHECKS_DIR).filter((n) => n.endsWith(".mjs")).sort()) {
    try {
      const mod = await import(pathToFileURL(join(CHECKS_DIR, name)).href);
      if (typeof mod.run === "function") found.push(...(await mod.run(ctx)).map((f) => ({ check: name.replace(/\.mjs$/, ""), ...f })));
    } catch (e) {
      found.push({ check: name, class: "other", file: "", message: `check crashed: ${String(e.message || e).slice(0, 120)}` });
    }
  }
  return found;
}

export function tail(text, n = OUTPUT_LINES) {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.length <= n ? lines.join("\n") : lines.slice(0, n).join("\n") + `\n… ${lines.length - n} more lines`;
}
