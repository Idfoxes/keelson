const STOP_WORDS =
  "а и но или что как это тот эта эти же ну вот бы ли не на в во с со по из за для к у о об от до при над под мне мой моя мои мы ты вы он она они надо нужно давай сделай " +
  "please can you the a an of to in on for with and or is are be do make let me my we you it this that";

export const STOP = new Set(STOP_WORDS.split(/\s+/));

export function stems(s, limit = 0) {
  const words = (String(s || "").toLowerCase().match(/\p{L}{3,}/gu) || [])
    .filter((w) => !STOP.has(w))
    .map((w) => w.slice(0, 5));
  const uniq = [...new Set(words)].sort();
  return limit ? uniq.slice(0, limit) : uniq;
}

export function signature(s, limit = 8) {
  return stems(s, limit).join(" ");
}

export function intersect(a, b) {
  let n = 0;
  for (const w of b) if (a.has(w)) n++;
  return n;
}

export function overlap(a, b) {
  const n = intersect(a, b);
  return { inter: n, ratio: n / Math.min(a.size, b.size) };
}

export function jaccard(a, b) {
  const n = intersect(a, b);
  return n / (a.size + b.size - n);
}

export const CHARS_PER_TOKEN_CYRILLIC = 1.2;
export const CHARS_PER_TOKEN_OTHER = 4;

export function estimateTokens(s) {
  const text = String(s || "");
  if (!text) return 0;
  const cyrillic = (text.match(/[\u0400-\u04FF]/g) || []).length;
  return Math.round(cyrillic / CHARS_PER_TOKEN_CYRILLIC + (text.length - cyrillic) / CHARS_PER_TOKEN_OTHER);
}

const MACHINE_HEAD = /^<(task-notification|system-reminder|command-name|command-message|local-command-|function_results|user-prompt-submit|agent-message|pasted_content|subagent|cross-session-message|scheduled-task)|^#\s*(Overview|Instructions|Files mentioned by the user)\b|^\[Artifact comment sent to Claude\]|^#\s*Autonomous loop tick|^The app was quit while you were working/i;
const MACHINE_BODY = /hyperpersonalized suggestions|ambient suggestions|Generate \d+ to \d+ \w+ suggestions/i;
const ROLE_PREAMBLE = /^You are (an?|the)\b/i;
const CYRILLIC = /[\u0400-\u04FF]/;

export function isMachineTurn(s) {
  const text = String(s || "");
  const head = text.trimStart().slice(0, 500);
  if (MACHINE_HEAD.test(head)) return true;
  if (MACHINE_BODY.test(text.slice(0, 2000))) return true;
  return ROLE_PREAMBLE.test(head) && !CYRILLIC.test(head);
}

export const CORRECTION = /^(нет|не так|неверно|неправильно|не туда|не там)(?!\p{L})|пересчита|переделай|исправь|поправь|почини|не надо|не нужно|убери|я же говорил|я уже говорил|перепроверь|почему ты|зачем ты|опять|^(?:no|nope|wrong)(?!\p{L})|not like that|redo|recalculate|fix (?:it|this)|undo|remove (?:it|this)|i (?:already )?(?:said|told you)|double-check|why did you|why are you|again/iu;
export const RETRY = /повтори|ещё раз|еще раз|попробуй снова|попробуй ещё|не сработал|не получилось|снова упал|try again|once more|one more time|did not work|didn't work|failed again/i;

export const APP_QUIT = /^The app was quit while you were working/i;

export const NUDGE = /^\s*(продолж\S*|дальше|continue|доделай|доделывай|go on|keep going|carry on|proceed|finish up)[\s.!]*$/i;
