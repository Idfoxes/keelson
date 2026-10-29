const ZONE = process.env.KEELSON_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
const FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export function localTime(ms) {
  const p = Object.fromEntries(FORMAT.formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, day: `${p.day}.${p.month}`, time: `${p.hour}:${p.minute}` };
}
