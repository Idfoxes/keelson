import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const BRIEF_LINES = 40;
const LIST_KEYS = new Set(["items", "entries", "results", "data", "list", "rows", "records"]);
const RAW = [
  ["cron", /(^|["'\s>])(\*|\d{1,2}|\*\/\d+)(\s+(\*|[\d,*/-]+)){4}(?=["'\s<]|$)/],
  ["path", /(^|["'`\s(])(~?\/[\w.-]+){2,}|s3:\/\/|~\/\.\w+/],
  ["JSON", /[{[]\s*\\?"\w+\\?"\s*:/],
];

export function loadConventions(root) {
  const file = join(root, ".agent", "conventions.json");
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return { broken: true }; }
}

function wordRe(word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}[\\p{L}]*(?![\\p{N}_])`, "iu");
}

function variants(canon) {
  const words = canon.split(/[_\-.\s]+/).filter(Boolean);
  const camel = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");
  return [...new Set([canon, words.join("_"), words.join("-"), words.join(" "), words.join("."), camel, camel[0].toUpperCase() + camel.slice(1)])]
    .sort((a, b) => b.length - a.length);
}

function withoutCanon(text, canon) {
  let t = text;
  for (const v of variants(canon)) t = t.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), " ");
  return t;
}

export function termHits(conv, rel, lines) {
  const out = [];
  for (const [canon, banned] of Object.entries(conv.terms || {})) {
    for (const word of banned) {
      const re = wordRe(word);
      const hit = lines.find((l) => re.test(withoutCanon(l.text, canon)));
      if (hit) out.push({ class: "terms", file: `${rel}:${hit.line}`, message: `${rel}:${hit.line}: “${word}”, the project term is “${canon}”` });
    }
  }
  return out;
}

function stringValues(text) {
  return [...text.matchAll(/:\s*(["'`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
}

export function rawHits(rel, lines) {
  const out = [];
  for (const [what, re] of RAW) {
    const hit = lines.find((l) => stringValues(l.text).some((v) => re.test(v)));
    if (hit) out.push({ class: "raw-value", file: `${rel}:${hit.line}`, message: `${rel}:${hit.line}: raw ${what} in a human-readable string: “${hit.text.trim().slice(0, 70)}”` });
  }
  return out;
}

function deref(doc, schema) {
  const ref = schema?.$ref;
  if (!ref) return [schema, ""];
  const name = ref.split("/").pop();
  return [doc.components?.schemas?.[name] || {}, name];
}

export function apiFindings(conv, doc) {
  const api = conv.api || {};
  const out = new Map();
  const add = (key, message) => out.set(key, { class: "contract", file: api.openapi, message });
  for (const [path, ops] of Object.entries(doc.paths || {})) {
    for (const [method, op] of Object.entries(ops || {})) {
      for (const [code, resp] of Object.entries(op?.responses || {})) {
        for (const media of Object.values(resp?.content || {})) {
          if (!media?.schema) continue;
          const [schema, name] = deref(doc, media.schema);
          if (api.error_schema && /^[45]\d\d$/.test(code) && name !== api.error_schema) {
            add(`err:${method}:${path}:${code}`, `${method.toUpperCase()} ${path} ${code}: schema ${name || schema.type || "none"}, the project returns errors as ${api.error_schema}`);
          }
          if (api.page_shape && method === "get" && code === "200") {
            if (schema.type === "array") add(`page:${path}`, `GET ${path}: bare array, the project returns lists as {${api.page_shape.join(", ")}}`);
            const arrays = Object.entries(schema.properties || {}).filter(([, p]) => p?.type === "array").map(([k]) => k);
            const looksLikePage = /(page|list)$/i.test(name) || arrays.some((k) => LIST_KEYS.has(k));
            if (looksLikePage && arrays.length === 1 && Object.keys(schema.properties).length <= 3 && (arrays[0] !== api.page_shape[0] || !schema.properties[api.page_shape[1]])) {
              add(`page:${path}`, `GET ${path}: page ${name || "unnamed"} {${Object.keys(schema.properties).join(", ")}}, the project uses {${api.page_shape.join(", ")}}`);
            }
          }
        }
      }
    }
  }
  for (const [field, enumName] of Object.entries(api.enum_fields || {})) {
    const [schemaName, prop] = field.split(".");
    const p = doc.components?.schemas?.[schemaName]?.properties?.[prop];
    if (p && p.type === "string" && !p.enum && !p.$ref && !(p.allOf || p.anyOf || []).some((x) => x.$ref)) {
      add(`enum:${field}`, `${field}: free-form string, the project uses ${enumName}`);
    }
  }
  return out;
}

export function headJson(root, rel) {
  try {
    return JSON.parse(execFileSync("git", ["-C", root, "show", `HEAD:${rel}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, maxBuffer: 32 * 1024 * 1024 }));
  } catch {
    return null;
  }
}

export function touchedSince(root, rel, startedAt) {
  try { return statSync(join(root, rel)).mtimeMs >= startedAt; } catch { return false; }
}

export function brief(conv) {
  if (!conv || conv.broken) return "";
  const lines = Object.entries(conv.terms || {}).map(([canon, banned]) => `${canon} (not ${banned.join(", ")})`);
  const api = conv.api || {};
  if (api.error_schema) lines.push(`API errors: ${api.error_schema}`);
  if (api.page_shape) lines.push(`list page: {${api.page_shape.join(", ")}}`);
  for (const [field, enumName] of Object.entries(api.enum_fields || {})) lines.push(`${field}: ${enumName}`);
  if (conv.ui?.no_raw) lines.push("no raw cron expressions, paths or JSON in the UI");
  if (!lines.length) return "";
  const shown = lines.slice(0, BRIEF_LINES - 1);
  return "Project vocabulary and contracts (.agent/conventions.json, checked by the gates):\n" + shown.join("\n") + (lines.length > shown.length ? `\n… ${lines.length - shown.length} more` : "");
}
