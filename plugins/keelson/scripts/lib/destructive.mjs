const TEMP_OPERAND = /^(\/tmp(\/|$)|\/private\/tmp(\/|$)|\/var\/folders\/|\$TMPDIR|\$\{TMPDIR|(\.\/)?\.agent\/scratch(\/|$))|\/scratchpad(\/|$)|\/\.agent\/scratch(\/|$)/;
const REGENERABLE = /(^|\/)(node_modules|\.venv|venv|dist|build|target|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.import_linter_cache|\.tox|\.nox|coverage|htmlcov|test-results|playwright-report|\.next|\.nuxt|\.turbo|\.parcel-cache|\.gradle|\.vite|\.eggs|[\w.-]+\.egg-info)(\/|$)/;
const WRAPPER_VALUE_FLAGS = {
  sudo: ["-u", "-g", "-C", "-h", "-p", "-U", "-D", "-r", "-t", "--user", "--group", "--chdir", "--prompt", "--host"],
  doas: ["-u", "-C"],
  env: ["-u", "-C", "-S", "--unset", "--chdir"],
  nice: ["-n", "--adjustment"],
  ionice: ["-c", "-n", "-p", "--class", "--classdata"],
  xargs: ["-I", "-P", "-n", "-L", "-s", "-E", "-d", "-a", "--max-procs", "--max-args", "--delimiter", "--arg-file"],
  timeout: ["-s", "-k", "--signal", "--kill-after"],
  stdbuf: ["-i", "-o", "-e"],
  exec: ["-a"],
  time: ["-f", "-o"],
  caffeinate: ["-t", "-w"],
  watch: ["-n", "--interval"],
  command: [],
  nohup: [],
  builtin: [],
};
const WRAPPERS = new Set(Object.keys(WRAPPER_VALUE_FLAGS));
export const SECRET_READ = "reading a secret from the Keychain";
export const TRUST_STORE = /trusted-repos\.txt|quality-gate\.mjs["']?\s+trust\b/;
const KEYWORDS = new Set(["then", "do", "else", "elif", "if", "while", "until", "!", "{", "}", "time", "export", "local", "declare", "readonly"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish"]);
const SHELL_VALUE_OPTS = new Set(["--rcfile", "--init-file"]);
const SQL_CLIENTS = new Set(["psql", "mysql", "mariadb", "sqlite3", "clickhouse-client", "clickhouse", "duckdb"]);
const SQL_FLAGS = new Set(["-c", "--command", "-e", "--execute", "-q", "--query"]);
const INTERPRETERS = /^(python[\d.]*|node|ruby|perl|php|deno|bun)$/;
const CLUSTER_SCOPED = /^(ns|namespace|namespaces|pv|persistentvolume|persistentvolumes|node|nodes|no|crd|crds|customresourcedefinitions?|clusterroles?|clusterrolebindings?|storageclass(es)?|sc|all)(\.|\/|$)/i;
const KUBECTL_VALUE_FLAGS = new Set(["-n", "--namespace", "--context", "--kubeconfig", "--cluster", "--user", "-s", "--server", "-l", "--selector", "-f", "--filename", "-o", "--output", "--for", "--field-selector", "-c", "--container", "--timeout", "--as", "--token", "--grace-period"]);
const DROP = /\bdrop\s+(table|database|schema|index|view|materialized\s+view|sequence|user|role|function|procedure|type|extension|owned|dictionary|partition|column)\b/i;
const CODE_DELETES = /shutil\.rmtree\s*\(|\bos\.(remove|unlink|rmdir|removedirs)\s*\(|\.unlink\s*\(|\.rmdir\s*\(|fs\.(rmSync|rm|unlinkSync|rmdirSync)\s*\(|rimraf|\bdelete_objects?\s*\(|delete_bucket\s*\(|\.objects\.(all|filter)\([^)]*\)\.delete\s*\(|FileUtils\.rm_r|\bunlink\s*\(/;
const MONGO_DELETES = /\.drop(Database)?\s*\(|\.(deleteMany|remove)\s*\(\s*\{\s*\}\s*\)/;

function closing(src, i) {
  let depth = 1;
  for (let j = i; j < src.length; j += 1) {
    const c = src[j];
    if (c === "\\") { j += 1; continue; }
    if (c === "'") { const e = src.indexOf("'", j + 1); if (e < 0) return src.length; j = e; continue; }
    if (c === '"') { j += 1; while (j < src.length && src[j] !== '"') { if (src[j] === "\\") j += 1; j += 1; } continue; }
    if (c === "(") depth += 1;
    if (c === ")" && --depth === 0) return j;
  }
  return src.length;
}

function substitutions(body) {
  const out = [];
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === "\\") { i += 1; continue; }
    if (body[i] === "$" && body[i + 1] === "(") { const e = closing(body, i + 2); out.push(body.slice(i + 2, e)); i = e; continue; }
    if (body[i] === "`") { const e = body.indexOf("`", i + 1); if (e < 0) break; out.push(body.slice(i + 1, e)); i = e; }
  }
  return out;
}

export function lex(src) {
  const quoted = [];
  const heredocs = [];
  const subs = [];
  const inner = [];
  const pending = [];
  let out = "";
  let wordStart = true;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\\") {
      if (src[i + 1] === "\n") { out += " "; i += 2; continue; }
      out += c + (src[i + 1] ?? "");
      i += 2;
      wordStart = false;
      continue;
    }
    if (c === "'") {
      const e = src.indexOf("'", i + 1);
      const end = e < 0 ? n : e;
      quoted.push(src.slice(i + 1, end));
      out += `__Q${quoted.length - 1}__`;
      i = end + 1;
      wordStart = false;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let body = "";
      let raw = "";
      while (j < n && src[j] !== '"') {
        if (src[j] === "\\" && j + 1 < n) { body += src[j + 1]; raw += src[j] + src[j + 1]; j += 2; continue; }
        body += src[j];
        raw += src[j];
        j += 1;
      }
      quoted.push(body);
      inner.push(...substitutions(raw));
      out += `__Q${quoted.length - 1}__`;
      i = j + 1;
      wordStart = false;
      continue;
    }
    if ((c === "$" || c === "<" || c === ">") && src[i + 1] === "(") {
      const e = closing(src, i + 2);
      inner.push(src.slice(i + 2, e));
      subs.push(src.slice(i + 2, e));
      out += `__S${subs.length - 1}__`;
      i = e + 1;
      wordStart = false;
      continue;
    }
    if (c === "`") {
      const e = src.indexOf("`", i + 1);
      const end = e < 0 ? n : e;
      inner.push(src.slice(i + 1, end));
      subs.push(src.slice(i + 1, end));
      out += `__S${subs.length - 1}__`;
      i = end + 1;
      wordStart = false;
      continue;
    }
    if (c === "#" && wordStart) {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "<" && src[i + 1] === "<" && src[i + 2] !== "<") {
      const m = src.slice(i + 2).match(/^(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/);
      if (m) {
        heredocs.push("");
        pending.push({ id: heredocs.length - 1, tag: m[3], strip: m[1] === "-" });
        out += ` __H${heredocs.length - 1}__ `;
        i += 2 + m[0].length;
        wordStart = false;
        continue;
      }
    }
    if (c === "\n") {
      out += "\n";
      i += 1;
      wordStart = true;
      while (pending.length) {
        const h = pending.shift();
        const lines = [];
        while (i < n) {
          const e = src.indexOf("\n", i);
          const line = src.slice(i, e < 0 ? n : e);
          i = e < 0 ? n : e + 1;
          if ((h.strip ? line.replace(/^\t+/, "") : line).trim() === h.tag) break;
          lines.push(line);
        }
        heredocs[h.id] = lines.join("\n");
      }
      continue;
    }
    out += c;
    wordStart = /[\s;&|()]/.test(c);
    i += 1;
  }
  return { text: out, quoted, heredocs, subs, inner };
}

function segments(text) {
  const parts = text.split(/(\|\||&&|\||;|&|\n|\(|\))/);
  const out = [];
  let piped = null;
  let sameShell = true;
  for (let k = 0; k < parts.length; k += 2) {
    const seg = parts[k].trim();
    const sep = parts[k + 1];
    if (seg) { out.push({ text: seg, pipedFrom: piped, sameShell }); sameShell = true; }
    piped = sep === "|" && seg ? seg : null;
    if (sep && sep !== "&&") sameShell = false;
  }
  return out;
}

function cdTarget(ws, ctx) {
  const { args, name } = command(ws);
  if (name !== "cd") return undefined;
  const dir = args.slice(1).find((a) => !a.startsWith("-"));
  return Boolean(dir && isTemp(dir, ctx));
}

function tokens(segment, ctx) {
  return segment.split(/\s+/).filter(Boolean).map((t) => t.replace(/__Q(\d+)__/g, (_, n) => ctx.quoted[Number(n)]));
}

function command(ws) {
  const via = [];
  const env = [];
  let i = 0;
  while (i < ws.length) {
    const w = ws[i].replace(/^\\/, "");
    if (KEYWORDS.has(w)) { i += 1; continue; }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { env.push(w); i += 1; continue; }
    const base = w.split("/").pop();
    if (WRAPPERS.has(base)) {
      via.push(base);
      i += 1;
      while (i < ws.length && ws[i].startsWith("-")) {
        if (ws[i] === "--") { i += 1; break; }
        i += WRAPPER_VALUE_FLAGS[base].includes(ws[i]) ? 2 : 1;
      }
      while (base === "env" && i < ws.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[i])) { env.push(ws[i]); i += 1; }
      if (base === "timeout" && i < ws.length && /^\d/.test(ws[i])) i += 1;
      if (base === "nice" && i < ws.length && /^-?\d+$/.test(ws[i])) i += 1;
      continue;
    }
    break;
  }
  const args = ws.slice(i);
  if (args.length) args[0] = args[0].replace(/^\\/, "");
  return { args, via, env, name: (args[0] || "").split("/").pop() };
}

function heredocBodies(args, ctx) {
  return args.flatMap((a) => [...a.matchAll(/__H(\d+)__/g)].map((m) => ctx.heredocs[Number(m[1])] || ""));
}

function hereString(args) {
  const at = args.indexOf("<<<");
  return at >= 0 && at + 1 < args.length ? args[at + 1] : null;
}

function pipedText(ctx, seg) {
  if (!seg.pipedFrom) return null;
  const { args, name } = command(tokens(seg.pipedFrom, ctx));
  if (name === "echo" || name === "printf") return args.slice(1).filter((a) => !/^-[neE]+$/.test(a)).join(" ").replace(/\\n/g, "\n");
  if (name === "cat") return heredocBodies(args, ctx).join("\n") || null;
  return null;
}

function operands(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (/^(\d?>>?|&>|<|<<<)$/.test(a)) { i += 1; continue; }
    if (/^(\d?>>?|&>|<)\S/.test(a) || a.startsWith("-") || /^__H\d+__$/.test(a)) continue;
    out.push(a);
  }
  return out;
}

function isTemp(p, ctx) {
  if (p.includes("..")) return false;
  if (TEMP_OPERAND.test(p)) return true;
  const v = p.match(/^\$\{?([A-Za-z_]\w*)\}?(\/|$)/);
  return Boolean(v && ctx.tempVars.has(v[1]));
}

function allTemp(paths, ctx) {
  return paths.length > 0 && paths.every((p) => isTemp(p, ctx));
}

function allDisposable(paths, ctx) {
  const inTempCwd = (p) => ctx.tempCwd && !/^[/~$]/.test(p) && !p.includes("..") && !/[*?]/.test(p);
  const expand = (p) => p.replace(/^\$\{?([A-Za-z_]\w*)\}?(?=\/|$)/, (m, name) => ctx.literalVars?.get(name) ?? m);
  const regenerable = (p) => REGENERABLE.test(p) && !p.includes("..") && !/[*?$]/.test(p);
  return paths.length > 0 && paths.every((p) => isTemp(p, ctx) || inTempCwd(p) || regenerable(expand(p)));
}

export function sqlReason(sql) {
  for (const statement of String(sql || "").split(";")) {
    if (DROP.test(statement)) return "SQL DROP";
    if (/\btruncate\s+(table\s+)?[\w."`]/i.test(statement)) return "SQL TRUNCATE";
    if (/\bdelete\s+from\b/i.test(statement) && !/\bwhere\b/i.test(statement)) return "SQL DELETE without WHERE";
    if (/\bupdate\s+[\w."`]+\s+set\b/i.test(statement) && !/\bwhere\b/i.test(statement)) return "SQL UPDATE without WHERE";
    if (/\balter\s+table\b[\s\S]*\b(delete|drop)\b/i.test(statement)) return "SQL ALTER TABLE that drops data";
  }
  return null;
}

function codeReason(code) {
  if (!code) return null;
  const sql = sqlReason(code);
  if (sql) return `${sql} in code`;
  if (CODE_DELETES.test(code)) return "code deletes files or objects";
  return null;
}

function flagValues(args, flags) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (flags.has(args[i]) && i + 1 < args.length) out.push(args[i + 1]);
    const eq = args[i].match(/^(--[\w-]+)=([\s\S]*)$/);
    if (eq && flags.has(eq[1])) out.push(eq[2]);
    const glued = args[i].match(/^(-[a-z])(\S[\s\S]*)$/);
    if (glued && flags.has(glued[1]) && !args[i].startsWith("--")) out.push(glued[2]);
  }
  return out;
}

function gitReason(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) i += /^(-C|-c|--git-dir|--work-tree|--namespace)$/.test(args[i]) ? 2 : 1;
  const sub = args[i] || "";
  const rest = args.slice(i + 1);
  const shortFlag = (letter) => rest.some((a) => new RegExp(`^-[a-zA-Z]*${letter}[a-zA-Z]*$`).test(a));
  const whole = (list) => list.some((a) => a === "." || a === ":/" || a === "*" || a === ":/.");
  if (sub === "reset" && rest.includes("--hard")) return "git reset --hard discards uncommitted changes";
  if (sub === "clean" && (shortFlag("f") || rest.includes("--force"))) return shortFlag("x") || shortFlag("X") ? "git clean -x also removes ignored files (.env, data, caches)" : "git clean removes untracked files";
  if (sub === "checkout" && (rest.includes("-f") || rest.includes("--force") || whole(rest))) return "git checkout discards uncommitted changes";
  if (sub === "restore" && whole(rest) && !(rest.includes("--staged") && !rest.includes("--worktree"))) return "git restore discards uncommitted changes";
  if (sub === "stash" && /^(drop|clear)$/.test(rest[0] || "")) return "git stash drop deletes stashed changes";
  if (sub === "push") {
    if (shortFlag("f") || rest.some((a) => a === "--force" || a === "--mirror")) return "git push that rewrites history";
    if (rest.some((a) => a.startsWith("--force-with-lease")) && !leaseOnWorkBranch(rest)) return "git push that rewrites history";
    if (rest.some((a) => /^\+/.test(a))) return "git push that rewrites history";
    if (rest.some((a) => a === "--delete" || a === "-d" || /^:[^:]/.test(a))) return "git push deletes a remote branch";
  }
  if (sub === "branch" && (shortFlag("D") || (rest.includes("--delete") && rest.includes("--force")))) return "git branch -D deletes an unmerged branch";
  return null;
}

const PROTECTED_BRANCH = /^(refs\/heads\/)?(main|master|develop|production|prod|release([\/-].*)?)$/;

function leaseOnWorkBranch(rest) {
  const [remote, ...refspecs] = positional(rest, new Set(["--repo", "-o", "--push-option", "--receive-pack", "--exec"]));
  if (!remote || !refspecs.length) return false;
  return refspecs.every((spec) => {
    if (spec.startsWith("+") || /[*$`]/.test(spec)) return false;
    const dst = spec.includes(":") ? spec.split(":").pop() : spec;
    return Boolean(dst) && dst !== "HEAD" && !PROTECTED_BRANCH.test(dst);
  });
}

function positional(args, valueFlags) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") break;
    if (a.startsWith("-")) { if (valueFlags.has(a)) i += 1; continue; }
    out.push(a);
  }
  return out;
}

function kubectlReason(args, env, ctx, depth, seg) {
  const dd = args.indexOf("--");
  const pos = positional(args, KUBECTL_VALUE_FLAGS);
  const verb = pos[0] || "";
  if (verb === "exec" && dd >= 0) return check(args.slice(dd + 1), seg, ctx, depth);
  if (!/^(delete|drain|replace)$/.test(verb)) return null;
  if (verb === "replace" && !args.includes("--force")) return null;
  if (verb === "drain") return "kubectl drain evicts all pods from the node";
  const namespaces = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-n" || args[i] === "--namespace") namespaces.push(args[i + 1]);
    const eq = args[i].match(/^(?:--namespace=|-n=?)(.+)$/);
    if (eq) namespaces.push(eq[1]);
  }
  const foreign = args.some((a) => /^(-A|--all-namespaces|--context|--kubeconfig|--cluster|-s|--server)(=|$)/.test(a)) || env.some((e) => e.startsWith("KUBECONFIG="));
  const resources = (pos[1] || "").split(",").filter(Boolean);
  const fromFile = args.some((a) => /^(-f|--filename|-k|--kustomize)(=|$)/.test(a));
  const testOnly = namespaces.length > 0 && namespaces.every((ns) => /^(test|dev|staging|sandbox)$/.test(ns)) && !foreign && !fromFile && resources.length > 0 && !resources.some((r) => CLUSTER_SCOPED.test(r));
  return testOnly ? null : "kubectl delete outside a test namespace";
}

function dockerReason(name, args, ctx, depth, seg) {
  const global = new Set(["-H", "--host", "--context", "-c", "--config", "-l", "--log-level"]);
  let i = 0;
  if (name !== "docker-compose") while (i < args.length && args[i].startsWith("-")) i += global.has(args[i]) ? 2 : 1;
  const compose = name === "docker-compose" || args[i] === "compose";
  if (compose) {
    if (name !== "docker-compose") i += 1;
    const composeFlags = new Set(["-f", "--file", "-p", "--project-name", "--env-file", "--profile", "--project-directory", "--ansi"]);
    while (i < args.length && args[i].startsWith("-")) i += composeFlags.has(args[i]) ? 2 : 1;
    const sub = args[i] || "";
    const rest = args.slice(i + 1);
    if ((sub === "down" || sub === "rm") && rest.some((a) => a === "-v" || a === "--volumes" || /^-[a-zA-Z]*v/.test(a))) return "docker compose removes volumes";
    if (sub === "exec" || sub === "run") {
      const value = new Set(["-u", "--user", "-e", "--env", "-w", "--workdir", "--index", "--name", "-v", "--volume", "-p", "--publish", "--entrypoint", "-l", "--label"]);
      let j = 0;
      while (j < rest.length && rest[j].startsWith("-")) j += value.has(rest[j]) ? 2 : 1;
      return check(rest.slice(j + 1), seg, ctx, depth);
    }
    return null;
  }
  const sub = args[i] || "";
  const rest = args.slice(i + 1);
  if (sub === "exec" || sub === "run") {
    const value = sub === "exec"
      ? /^(-[uew]|--(user|env|workdir|env-file|detach-keys))$/
      : /^(-[vewupmhlc]|--(volume|env|workdir|user|publish|mount|name|network|entrypoint|label|env-file|memory|cpus|platform|hostname|add-host|device|dns|log-driver|restart|ulimit|shm-size|tmpfs|cap-add|cap-drop|security-opt|pull|gpus))$/;
    let j = 0;
    while (j < rest.length && rest[j].startsWith("-")) j += value.test(rest[j]) ? 2 : 1;
    return check(rest.slice(j + 1), seg, ctx, depth);
  }
  if (/^(system|volume|image|container|builder|network)$/.test(sub) && rest[0] === "prune") return "docker prune removes data";
  if (sub === "volume" && /^(rm|remove)$/.test(rest[0] || "")) return "docker volume rm removes data";
  return null;
}

function shellScript(args) {
  let i = 0;
  let c = false;
  while (i < args.length && /^[-+]/.test(args[i]) && args[i] !== "-" && args[i] !== "--") {
    if (SHELL_VALUE_OPTS.has(args[i]) || /^[-+][a-zA-Z]*[oO]$/.test(args[i])) { i += 2; continue; }
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(args[i])) c = true;
    i += 1;
  }
  if (args[i] === "--") i += 1;
  return { script: c ? args[i] : null, file: c ? null : args[i] };
}

function nested(list, ctx, depth) {
  for (const text of list) {
    const reason = destructiveReason(text, depth + 1);
    if (reason) return reason;
  }
  return null;
}

function check(ws, seg, ctx, depth) {
  const { args, via, env, name } = command(ws);
  const rest = args.slice(1);
  const docs = heredocBodies(rest, ctx);
  const here = hereString(rest);
  const piped = pipedText(ctx, seg);
  if (SHELLS.has(name)) {
    const { script, file } = shellScript(rest);
    if (script) return nested([script], ctx, depth);
    if (!file || file === "-s" || /^__H\d+__$/.test(file) || file === "<<<") return nested([...docs, here, piped].filter(Boolean), ctx, depth);
    return null;
  }
  if (name === "su") return nested(flagValues(rest, new Set(["-c", "--command"])), ctx, depth);
  if (name === "eval") return nested([rest.join(" ")], ctx, depth);
  if (name === "ssh") {
    let i = 0;
    while (i < rest.length && rest[i].startsWith("-")) i += /^-[BbcDEeFIiJLlmOoPpQRSWw]$/.test(rest[i]) ? 2 : 1;
    const remote = rest.slice(i + 1).filter((a) => !/^__H\d+__$/.test(a) && a !== "<<<" && a !== here);
    return nested([remote.join(" "), ...docs, here, piped].filter(Boolean), ctx, depth);
  }
  if (SQL_CLIENTS.has(name)) {
    const texts = [...flagValues(rest, SQL_FLAGS), ...docs, here, piped];
    if (name === "sqlite3" || name === "duckdb") texts.push(...operands(rest).slice(1));
    return texts.map(sqlReason).find(Boolean) || null;
  }
  if (name === "dropdb" || name === "dropuser") return `${name} drops a database or user`;
  if (/^(mongosh|mongo)$/.test(name)) {
    const code = [...flagValues(rest, new Set(["--eval"])), ...docs, here, piped].join("\n");
    return MONGO_DELETES.test(code) ? "dropping a collection or database in MongoDB" : null;
  }
  if (INTERPRETERS.test(name)) {
    const code = [...flagValues(rest, new Set(["-c", "-e", "--eval", "-p", "--print"])), ...docs, here, rest.includes("-") || rest.length === 0 ? piped : null].filter(Boolean).join("\n");
    return codeReason(code);
  }
  if (name === "rclone" && rest.some((a) => /^(delete|deletefile|purge|rmdir|rmdirs|sync|move|moveto|cleanup|dedupe)$/.test(a))) return "rclone deletes or overwrites data in storage";
  if (name === "aws") {
    const pos = positional(rest, new Set(["--endpoint-url", "--profile", "--region", "--output", "--ca-bundle", "--query", "--color", "--cli-read-timeout", "--cli-connect-timeout", "--bucket", "--key", "--prefix", "--delete", "--exclude", "--include"]));
    const [service, sub] = pos;
    if (service === "s3" && /^(rm|mv|rb)$/.test(sub || "")) return "deleting objects in object storage";
    if (service === "s3" && sub === "sync" && rest.includes("--delete")) return "aws s3 sync --delete removes objects that are missing from the source";
    if (/^(delete|remove|terminate|purge)-/.test(sub || "")) return `aws ${service} ${sub}`;
    return null;
  }
  if (name === "s3cmd" && (rest.some((a) => /^(del|rm|rb|delete)$/.test(a)) || rest.includes("--delete-removed"))) return "deleting objects in S3";
  if (name === "s5cmd" && rest.some((a) => /^(rm|mv)$/.test(a))) return "deleting objects in S3";
  if (name === "gsutil" && (rest.some((a) => /^(rm|rb)$/.test(a)) || (rest.includes("rsync") && rest.some((a) => /^-[a-zA-Z]*d/.test(a))))) return "deleting objects in object storage";
  if (name === "mc" && (rest.some((a) => /^(rm|rb)$/.test(a)) || (rest.includes("mirror") && rest.some((a) => a === "--remove" || a === "--overwrite")))) return "deleting objects in object storage";
  if (name === "kubectl" || name === "oc") return kubectlReason(rest, env, ctx, depth, seg);
  if (name === "docker" || name === "podman" || name === "docker-compose") return dockerReason(name, rest, ctx, depth, seg);
  if (name === "helm") {
    const pos = positional(rest, new Set(["-n", "--namespace", "--kube-context", "--kubeconfig"]));
    if (/^(uninstall|delete|del|un)$/.test(pos[0] || "")) return "helm uninstall";
    return null;
  }
  if (name === "rsync" && rest.some((a) => a.startsWith("--del") || a === "--remove-source-files")) return "rsync deletes files in the destination or the source";
  if (name === "redis-cli" && rest.some((a) => /^flush(all|db)$/i.test(a))) return "redis FLUSHALL";
  if (name === "redis-cli" && via.includes("xargs") && rest.some((a) => /^(del|unlink)$/i.test(a))) return "bulk deletion of redis keys";
  if (name === "dd" && rest.some((a) => a.startsWith("of=/dev/") && !/^of=\/dev\/(null|zero|stdout|stderr)$/.test(a))) return "dd to a device";
  if (name === "truncate" && rest.some((a) => /^(-s|--size)/.test(a))) return "truncate empties a file";
  if (/^mkfs(\.|$)/.test(name) || name === "wipefs" || name === "shred" || (name === "diskutil" && rest.some((a) => /^(erase|zero|secureErase)/i.test(a)))) return `${name} destroys data`;
  if (name === "crontab" && rest.includes("-r")) return "crontab -r deletes all cron jobs";
  if ((name === "rm" || name === "unlink") && via.includes("xargs")) return "rm over a list from xargs";
  if (name === "rm" && rest.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === "--recursive") && !allDisposable(operands(rest), ctx)) return "recursive rm";
  if (name === "find") {
    const roots = [];
    for (const a of rest) { if (a.startsWith("-") || a === "!" || a === "(" || a === "\\(") break; roots.push(a); }
    const at = rest.findIndex((a) => /^-(exec|execdir|ok|okdir)$/.test(a));
    const end = rest.findIndex((a, k) => at >= 0 && k > at && /^(\\?;|\+)$/.test(a));
    const execCmd = at < 0 ? [] : rest.slice(at + 1, end < 0 ? undefined : end);
    const execName = (execCmd[0] || "").split("/").pop();
    if ((rest.includes("-delete") || /^(rm|unlink|shred)$/.test(execName)) && !allTemp(roots, ctx)) return "find that deletes files";
    if (execCmd.length) return check(execCmd, seg, ctx, depth);
    return null;
  }
  if (name === "git") return gitReason(rest);
  if (name === "security") return keychainReason(rest);
  return null;
}

function keychainReason(args) {
  const sub = args[0] || "";
  if (/^(dump-keychain|export)$/.test(sub)) return `${SECRET_READ}: security ${sub}`;
  if (!/^find-(generic|internet)-password$/.test(sub) || !args.some((a) => a === "-w" || a === "-g")) return null;
  const at = args.indexOf("-s");
  const service = at >= 0 ? args[at + 1] || "" : "";
  if (service.startsWith("keelson-")) return null;
  return `${SECRET_READ}: ${service || sub}`;
}

function literalVars(segs, ctx) {
  const vars = new Map();
  for (const seg of segs) {
    for (const t of tokens(seg.text, ctx)) {
      const m = t.match(/^([A-Za-z_]\w*)=(\/[^\s$`*?]*)$/);
      if (m && !m[2].includes("..") && !/__[A-Z]\d+__/.test(m[2])) vars.set(m[1], m[2]);
    }
  }
  return vars;
}

function tempVars(segs, ctx) {
  const vars = new Set();
  for (const seg of segs) {
    for (const t of tokens(seg.text, ctx)) {
      const m = t.match(/^([A-Za-z_]\w*)=(.*)$/);
      if (!m) continue;
      const s = m[2].match(/^__S(\d+)__$/);
      if ((s && /^\s*mktemp\b/.test(ctx.subs[Number(s[1])] || "")) || (TEMP_OPERAND.test(m[2]) && !m[2].includes(".."))) vars.add(m[1]);
    }
  }
  return vars;
}

export function destructiveReasons(input, depth = 0) {
  const commandText = String(input || "");
  if (depth > 4 || !commandText.trim()) return [];
  const ctx = lex(commandText);
  const reasons = ctx.inner.map((text) => destructiveReason(text, depth + 1));
  const segs = segments(ctx.text);
  ctx.tempVars = tempVars(segs, ctx);
  ctx.literalVars = literalVars(segs, ctx);
  ctx.tempCwd = false;
  for (const seg of segs) {
    if (!seg.sameShell) ctx.tempCwd = false;
    const ws = tokens(seg.text, ctx);
    const cd = cdTarget(ws, ctx);
    if (cd !== undefined) { ctx.tempCwd = cd; continue; }
    reasons.push(check(ws, seg, ctx, depth));
  }
  return [...new Set(reasons.filter(Boolean))];
}

export function destructiveReason(input, depth = 0) {
  return destructiveReasons(input, depth)[0] || null;
}
