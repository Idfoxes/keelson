export const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<PEM>", "pem"],
  [/\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, "<TOKEN>", "token"],
  [/\b([A-Za-z0-9._%-]+):([^\s:@/]{3,})@([A-Za-z0-9.-]+)/g, "$1:<PASSWORD>@$3", "password"],
  [/\b([A-Z_]*(?:PASSWORD|SECRET|TOKEN|API_?KEY|CREDENTIALS|PASSWD))\s*[=:]\s*\S+/gi, "$1=<VALUE>", "envsecret"],
  [/(^|[^\p{L}\p{N}_])(AK|SK|access[ _-]?key|secret[ _-]?key|password|token|secret)\s*[=:]\s*[^\s,;]+/giu, "$1$2: <VALUE>", "labeled"],
  [/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}):(\S{4,})/g, "$1:<PASSWORD>", "mailpass"],
  [/(<EMAIL>):(\S{4,})/g, "$1:<PASSWORD>", "mailpass"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<EMAIL>", "email"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<IP>", "ip"],
  [/\b[A-Za-z0-9-]+\.(?:internal|local|corp)\b/gi, "<INTERNAL-HOST>", "host"],
  [/([?&](?:key|token|api[_-]?key|access[_-]?token|sig|signature)=)[^&\s]+/gi, "$1<REDACTED>", "urlsecret"],
  [/\b[A-Fa-f0-9]{32,}\b/g, "<HEX>", "hexblob"],
];

export function redact(s, skip = []) {
  const hits = [];
  for (const [re, repl, name] of RULES) {
    if (skip.includes(name)) continue;
    if (re.test(s)) { hits.push(name); s = s.replace(re, repl); }
    re.lastIndex = 0;
  }
  return { text: s.replace(/\s+/g, " ").trim(), hits };
}
