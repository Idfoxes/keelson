import { PRICES, cacheReadPerM } from "./prices.mjs";
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const EDIT_ECHO_CHARS = 600;
const WRITE_ECHO_CHARS = 200;
export const CACHE_READ_USD_PER_M = PRICES.opus.cacheRead;
export const CHARS_PER_TOKEN = 3.5;
export const IMAGE_TOKENS = 1600;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
const BASE64 = /^[A-Za-z0-9+/]{1000}/;

export function seenChars(tool, input, response) {
  const i = input || {};
  if (tool === "Edit") return String(i.new_string || "").length + EDIT_ECHO_CHARS;
  if (tool === "MultiEdit") return (i.edits || []).reduce((a, e) => a + String(e.new_string || "").length, 0) + EDIT_ECHO_CHARS;
  if (tool === "NotebookEdit") return String(i.new_source || "").length + EDIT_ECHO_CHARS;
  if (tool === "Write") return WRITE_ECHO_CHARS;
  let images = 0;
  const text = JSON.stringify(response ?? "", (key, value) => {
    if (typeof value === "string" && value.length >= 1000 && BASE64.test(value)) { images++; return ""; }
    return value;
  });
  return text.length + images * IMAGE_TOKENS * CHARS_PER_TOKEN;
}

export function tokensOf(row) {
  const tokens = row.tokens || 0;
  if (row.tool === "Read" && (row.v || 0) < 3 && IMAGE_FILE.test(String(row.target || ""))) return Math.min(tokens, IMAGE_TOKENS);
  return tokens;
}

export function trusted(row) {
  return !(EDIT_TOOLS.has(row.tool) && !row.v);
}

export function callCostUsd(row) {
  return (row.ctx || 0) / 1e6 * cacheReadPerM(row.model, row.ctx || 0);
}
