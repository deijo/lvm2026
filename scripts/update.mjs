// Hämtar schemat och skriver data/schedule.json om något har ändrats.
// Används av .github/workflows/update.yml. Kör lokalt med: node scripts/update.mjs
import { readFile, writeFile } from "node:fs/promises";
import { fetchAll } from "./schedule.mjs";

const FILE = new URL("../data/schedule.json", import.meta.url);

const data = await fetchAll();
const body = JSON.stringify(data);

let old = null;
try {
  old = JSON.parse(await readFile(FILE, "utf8"));
} catch {}

const oldBody = old ? JSON.stringify({ teams: old.teams, events: old.events, playoffs: old.playoffs }) : "";
if (oldBody === body) {
  console.log("Ingen ändring i schemat.");
} else {
  const out = { changed: Date.now(), ...data };
  await writeFile(FILE, JSON.stringify(out, null, 1) + "\n");
  console.log(`Schemat uppdaterat: ${data.events.length} händelser, ${data.playoffs.length} slutspelsmatcher.`);
}
