export const PRICES = {
  opus: { cacheRead: 0.4, input: 4, output: 20 },
  sonnet: { cacheRead: 0.1, input: 2, output: 10 },
  haiku: { cacheRead: 0.01, cacheReadLong: 0.05, longFrom: 100000, input: 0.1, output: 0.5 },
  fable: { cacheRead: 0.25, input: 10, output: 50 },
};
export const DEFAULT_FAMILY = "opus";

export function family(model) {
  const m = String(model || "").toLowerCase();
  return Object.keys(PRICES).find((f) => m.includes(f)) || "";
}

export function cacheReadPerM(model, ctx = 0) {
  const p = PRICES[family(model) || DEFAULT_FAMILY];
  return p.cacheReadLong && ctx > p.longFrom ? p.cacheReadLong : p.cacheRead;
}
