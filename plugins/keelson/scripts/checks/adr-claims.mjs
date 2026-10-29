import { extname } from "node:path";
import { ADR_DIRS } from "../lib/agent-dir.mjs";
import { addedLines } from "../lib/checks.mjs";

const CLAIM = /(быстрее|медленнее|надёжнее|надежнее|дешевле|выдерживает|масштабируется|эффективнее|лучше|faster|slower|cheaper|more reliable|scales|handles \d*|outperforms)/i;
const NUMBER = /\d/;
const SOURCE = /https?:\/\/|\.agent\/scratch\/bench|замер|measurement|measured|bench|benchmark/i;

export function run({ root, changedAll = [] }) {
  const findings = [];
  for (const rel of changedAll) {
    if (extname(rel) !== ".md" || !ADR_DIRS.some((d) => rel.startsWith(d + "/"))) continue;
    for (const { line, text } of addedLines(root, rel)) {
      const claim = text.match(CLAIM)?.[0];
      if (!claim || (NUMBER.test(text) && SOURCE.test(text))) continue;
      findings.push({ class: "other", file: `${rel}:${line}`, message: `${rel}:${line}: “${claim}” has no number and no source. A measurement or documentation with a number and a link is needed` });
      break;
    }
  }
  return findings;
}
