// Hämtar schemat från Cupmanagers API och gör om det till en enkel lista.
// Körs av GitHub Actions (scripts/update.mjs), eftersom turneringens server
// inte tillåter anrop direkt från webbläsare på andra webbplatser.

export const CONFIG = {
  api: "https://lundvolleymasters.cupmanager.net/rest/results_api/call",
  tournamentId: 74411791,
  categoryId: 74411948, // FU18 (född -10)
  // Lägg till fler lag här: id = numret i lagets länk (/result/team/...),
  // referee = numret i lagets domarlänk (/result/referee/...).
  teams: [
    { key: "white", label: "White", name: "Habo Wolley White", id: 82397484, referee: 88506314 },
    { key: "red", label: "Red", name: "Habo Wolley Red", id: 82397479, referee: 88506301 },
  ],
};

async function call(query) {
  const url = `${CONFIG.api}?call=${encodeURIComponent(query)}&lang=sv&tournamentId=${CONFIG.tournamentId}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`API svarade ${r.status} för ${query.slice(0, 60)}`);
  const j = await r.json();
  if (!j.responses) throw new Error("Oväntat svar från API:t");
  return j.responses;
}

const nm = (n) => {
  if (n == null) return "";
  if (typeof n === "string") return n;
  return n.sv || n.en || Object.values(n)[0] || "";
};
const idOf = (href) => (href ? Number((href.match(/id:(\d+)/) || [])[1]) || null : null);

const MATCH_FIELDS =
  "arena:{},home:{team:{}},away:{team:{}},division:{},roundName:{},result:{},referees:[{referee:{}}]";

export async function fetchAll() {
  const catQ = `Category({categoryId:${CONFIG.categoryId},tournamentId:${CONFIG.tournamentId}}){stages:[{name:{},divisions:[{... on Division:{matches:[{... on Match:{${MATCH_FIELDS}}}]}}]}]}`;
  const refQ = (id) => `Referee({id:${id}}){... on Referee:{days:[{day:{},matches:[{${MATCH_FIELDS}}]}]}}`;
  const parts = await Promise.all([call(catQ), ...CONFIG.teams.map((t) => call(refQ(t.referee)))]);
  return normalize(parts);
}

export function normalize([cat, ...refs]) {
  const teamById = Object.fromEntries(CONFIG.teams.map((t) => [t.id, t]));
  const teamByRef = Object.fromEntries(CONFIG.teams.map((t) => [t.referee, t]));

  const readMatch = (R, href, extra = {}) => {
    const E = (h) => (h && R[h] ? R[h].entity : undefined);
    const M = E(href);
    if (!M) return null;
    const A = E(M.arena?.href) || {};
    const side = (h) => {
      const a = E(h) || {};
      return { name: nm(a.name), teamId: idOf(a.team?.href) };
    };
    const D = E(M.division?.href) || {};
    const res = E(M.result?.href) || {};
    const referees = (E(`${href}$referees`) || []).map((x) => {
      const id = idOf(x.referee?.href);
      const full = E(x.referee?.href)?.name || "";
      // "FU18 (född -10) - Borgen VK" → "Borgen VK"
      const name = full.includes(" - ") ? full.split(" - ").slice(1).join(" - ") : full;
      return { id, name, role: nm(x.positionName), ours: teamByRef[id]?.key || null };
    });
    return {
      id: M.id,
      nr: M.matchNr,
      start: M.start,
      end: M.end,
      hall: (A.completeName || "").replace(/\s*\d+$/, ""),
      court: A.fieldName || "",
      home: side(M.home?.href),
      away: side(M.away?.href),
      division: nm(D.name),
      round: nm(E(M.roundName?.href)?.name),
      referees,
      result: {
        finished: !!res.finished || !!M.finished,
        live: !!res.live || !!M.live,
        home: res.homeSetsWon ?? 0,
        away: res.awaySetsWon ?? 0,
      },
      stage: "",
      ...extra,
    };
  };

  // Alla matcher i klassen
  const all = [];
  const E = (h) => (h && cat[h] ? cat[h].entity : undefined);
  const stages = E(`Category({categoryId:${CONFIG.categoryId},tournamentId:${CONFIG.tournamentId}})$stages`);
  if (!Array.isArray(stages) || !stages.length) throw new Error("Hittade inga matcher i klassen");
  for (const s of stages) {
    const S = E(s.href) || {};
    const stageName = nm(E(S.name?.href) ?? S.name);
    for (const d of E(S.divisions?.href) || []) {
      const D = E(d.href) || {};
      for (const m of E(D.matches?.href) || []) {
        const x = readMatch(cat, m.href, { stage: stageName });
        if (x) all.push(x);
      }
    }
  }

  const events = [];
  const seen = new Set();
  const push = (e) => {
    const k = `${e.kind}-${e.team}-${e.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    events.push(e);
  };
  // Lagens egna matcher
  for (const m of all) {
    for (const side of ["home", "away"]) {
      const t = teamById[m[side].teamId];
      if (!t) continue;
      const opp = m[side === "home" ? "away" : "home"];
      push({ kind: "match", team: t.key, ...m, opponent: opp.name, us: side });
    }
  }
  // Domaruppdrag: från lagens domarscheman ...
  refs.forEach((R, i) => {
    const t = CONFIG.teams[i];
    const RE = (h) => (h && R[h] ? R[h].entity : undefined);
    for (const day of RE(`Referee({id:${t.referee}})$days`) || []) {
      for (const m of day.matches || []) {
        const x = readMatch(R, m.href);
        if (!x) continue;
        const mine = x.referees.find((r) => r.id === t.referee);
        push({ kind: "ref", team: t.key, ...x, role: mine?.role || "Domare" });
      }
    }
  });
  // ... och från klassens matcher, ifall domarschemat inte är publicerat för dagen än.
  for (const m of all) {
    for (const r of m.referees) {
      if (r.ours) push({ kind: "ref", team: r.ours, ...m, role: r.role || "Domare" });
    }
  }
  events.sort((a, b) => a.start - b.start || a.court.localeCompare(b.court));

  const playoffs = all
    .filter((m) => !/grupp/i.test(m.stage))
    .sort((a, b) => a.start - b.start || `${a.hall}${a.court}`.localeCompare(`${b.hall}${b.court}`));

  const teams = CONFIG.teams.map(({ key, label, name, id, referee }) => ({ key, label, name, id, referee }));
  return { teams, events, playoffs };
}
