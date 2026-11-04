// Hämtar schemat och skriver data/schedule.json när något har ändrats,
// och dessutom minst var 30:e minut så att sidan kan visa att kontrollen lever.
// Används av .github/workflows/update.yml. Kör lokalt med: node scripts/update.mjs
import { readFile, writeFile } from "node:fs/promises";
import { fetchAll } from "./schedule.mjs";

// Tillfälligt stopp: en pågående körning av den gamla, långlivade versionen
// hämtar den här filen och avslutas här. Tas bort när den körningen har stoppats.
if (process.env.GITHUB_ACTIONS && !process.env.LVM_SINGLE_RUN) {
  console.log("Uppdateringen är avstängd, avslutar den långlivade körningen.");
  process.kill(process.ppid, "SIGKILL");
  process.exit(1);
}

const FILE = new URL("../data/schedule.json", import.meta.url);
const HEARTBEAT_MS = 30 * 60 * 1000;

const data = await fetchAll();
const body = JSON.stringify(data);
const now = Date.now();

let old = null;
try {
  old = JSON.parse(await readFile(FILE, "utf8"));
} catch {}

const oldBody = old
  ? JSON.stringify({ teams: old.teams, categories: old.categories, events: old.events, playoffs: old.playoffs })
  : "";
const changed = oldBody !== body;
const lastCheck = old?.checked || old?.changed || 0;

if (!changed && now - lastCheck < HEARTBEAT_MS) {
  console.log("Ingen ändring i schemat.");
} else {
  const out = { changed: changed ? now : old.changed, checked: now, ...data };
  await writeFile(FILE, JSON.stringify(out, null, 1) + "\n");
  console.log(
    changed
      ? `Schemat ändrat: ${data.events.length} händelser, ${data.playoffs.length} slutspelsmatcher.`
      : "Ingen ändring, sparar kontrolltid."
  );
}
