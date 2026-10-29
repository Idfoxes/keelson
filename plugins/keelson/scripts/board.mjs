#!/usr/bin/env node
import { STATES, applyRetired, loadBoard } from "./lib/board.mjs";
import { localTime } from "./lib/local-time.mjs";

const DAY_MS = 86400000;
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf("--" + n); return i < 0 ? "" : argv[i + 1] || ""; };
const has = (n) => argv.includes("--" + n);

const days = Number(opt("days")) > 0 ? Number(opt("days")) : 1;
const project = opt("project").toLowerCase();
const now = Date.now();

const rank = (state) => {
  const i = STATES.indexOf(state);
  return i < 0 ? STATES.indexOf("working") : i;
};

const rows = applyRetired(loadBoard(now))
  .filter((e) => now - Date.parse(e.updated) <= days * DAY_MS)
  .filter((e) => !project || e.project.toLowerCase() === project)
  .sort((a, b) => rank(a.state) - rank(b.state) || Date.parse(b.updated) - Date.parse(a.updated));

if (has("json")) {
  console.log(JSON.stringify(rows, null, 2));
} else if (!rows.length) {
  console.log(`The board is empty: no sessions in the last ${days} days${project ? " for project " + opt("project") : ""}.`);
} else if (has("md")) {
  printTable();
} else {
  printLines();
}

function stamp(iso) {
  const t = localTime(Date.parse(iso));
  const today = localTime(now).date;
  return `${t.date === today ? "" : t.day + " "}${t.time} local time`;
}

function shown(e) {
  return e.state === "waiting" && e.what ? e.what : e.line;
}

function printLines() {
  let group = "";
  for (const e of rows) {
    const g = STATES[rank(e.state)];
    if (group && g !== group) console.log("");
    group = g;
    const state = e.state + (e.until ? ` until ${e.until}` : "");
    const text = shown(e);
    console.log(`${stamp(e.updated)}  ${e.project || "-"}  ${e.ticket || "-"}  ${state}${text ? ": " + text : ""}${e.links.length ? "  " + e.links.join(" ") : ""}`);
  }
}

function printTable() {
  const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  console.log("| Time | Project | Ticket | State | What | Links |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const e of rows) {
    const state = e.state + (e.until ? ` until ${e.until}` : "");
    console.log(`| ${cell(stamp(e.updated))} | ${cell(e.project)} | ${cell(e.ticket || "-")} | ${cell(state)} | ${cell(shown(e))} | ${cell(e.links.join(" "))} |`);
  }
}
