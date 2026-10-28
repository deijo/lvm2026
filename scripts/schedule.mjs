// Hämtar schemat för alla klubbens lag från Cupmanagers API och gör om det
// till en enkel lista. Körs av GitHub Actions (scripts/update.mjs), eftersom
// turneringens server inte tillåter anrop direkt från webbläsare på andra webbplatser.
//
// Klubbens lag, klasser och domar-id hittas automatiskt, så nya lag kommer med
// av sig själva.

export const CONFIG = {
  api: "https://lundvolleymasters.cupmanager.net/rest/results_api/call",
  tournamentId: 74411791,
  clubId: 82383983, // Habo Wolley
};

async function call(query) {
  const url = `${CONFIG.api}?call=${encodeURIComponent(query)}&lang=sv&tournamentId=${CONFIG.tournamentId}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`API svarade ${r.status} för ${query.slice(0, 60)}`);
      const j = await r.json();
      if (!j.responses) throw new Error("Oväntat svar från API:t");
      return j.responses;
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const nm = (n) => {
  if (n == null) return "";
  if (typeof n === "string") return n;
  return n.sv || n.en || Object.values(n)[0] || "";
};
const idOf = (href) => (href ? Number((href.match(/id:(\d+)/) || [])[1]) || null : null);
// "FU18 (född -10)" → "FU18"
const shortCat = (name) => name.replace(/\s*\(.*?\)\s*/g, " ").trim();

const MATCH_FIELDS =
  "arena:{},home:{team:{}},away:{team:{}},division:{},roundName:{},result:{},referees:[{referee:{}}]";

// Klubbens lag med klass och domar-id
async function discoverTeams() {
  const T = CONFIG.tournamentId;
  const [club, tour] = await Promise.all([
    call(`NameClub({id:${CONFIG.clubId}}){registeredTeams:[{team:{},category:{}}]}`),
    call(`Tournament({id:${T}}){referees:[{}]}`),
  ]);
  const CE = (h) => club[h]?.entity;
  const TE = (h) => tour[h]?.entity;
  const refByName = new Map(
    (TE(`Tournament({id:${T}})$referees`) || []).map((x) => TE(x.href)).filter(Boolean).map((r) => [r.name, r.id])
  );

  const teams = [];
  for (const x of CE(`NameClub({id:${CONFIG.clubId}})$registeredTeams`) || []) {
    const RT = CE(x.href);
    const team = CE(RT?.team?.href);
    const cat = CE(RT?.category?.href);
    if (!RT || !team || !cat) continue;
    const catName = nm(cat.name);
    const clubName = team.name?.clubName || "";
    const suffix = (team.name?.suffix || RT.teamSuffix || "").trim();
    const short = shortCat(catName);
    teams.push({
      key: `t${team.id}`,
      id: team.id,
      referee: refByName.get(`${catName} - ${clubName}`) || null,
      categoryId: RT.categoryId,
      category: short,
      suffix,
      label: suffix ? `${short} ${suffix}` : short,
      color: /^red/i.test(suffix) ? "red" : /^white/i.test(suffix) ? "white" : "club",
    });
  }
  if (!teams.length) throw new Error("Hittade inga lag för klubben");

  const order = (t) => [t.category.replace(/\d+/g, (d) => d.padStart(3, "0")), t.suffix === "Red" ? 1 : 0];
  teams.sort((a, b) => {
    const [ca, sa] = order(a);
    const [cb, sb] = order(b);
    return ca.localeCompare(cb) || sa - sb || a.suffix.localeCompare(b.suffix);
  });

  const categories = [];
  for (const t of teams) {
    let c = categories.find((c) => c.id === t.categoryId);
    if (!c) categories.push((c = { id: t.categoryId, name: t.category, teams: [] }));
    c.teams.push(t.key);
  }
  return { teams, categories };
}

export async function fetchAll() {
  const { teams, categories } = await discoverTeams();
  const T = CONFIG.tournamentId;
  const catQ = (id) =>
    `Category({categoryId:${id},tournamentId:${T}}){stages:[{name:{},divisions:[{... on Division:{matches:[{... on Match:{${MATCH_FIELDS}}}]}}]}]}`;
  const refQ = (id) => `Referee({id:${id}}){... on Referee:{days:[{day:{},matches:[{${MATCH_FIELDS}}]}]}}`;
  const refTeams = teams.filter((t) => t.referee);

  const catResp = await Promise.all(categories.map((c) => call(catQ(c.id))));
  const refResp = await Promise.all(refTeams.map((t) => call(refQ(t.referee))));
  return normalize({ teams, categories, catResp, refTeams, refResp });
}

export function normalize({ teams, categories, catResp, refTeams, refResp }) {
  const T = CONFIG.tournamentId;
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const teamByRef = Object.fromEntries(teams.filter((t) => t.referee).map((t) => [t.referee, t]));

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

  // Alla matcher i klubbens klasser
  const all = [];
  categories.forEach((c, i) => {
    const R = catResp[i];
    const E = (h) => (h && R[h] ? R[h].entity : undefined);
    const stages = E(`Category({categoryId:${c.id},tournamentId:${T}})$stages`) || [];
    for (const s of stages) {
      const S = E(s.href) || {};
      const stageName = nm(E(S.name?.href) ?? S.name);
      for (const d of E(S.divisions?.href) || []) {
        const D = E(d.href) || {};
        for (const m of E(D.matches?.href) || []) {
          const x = readMatch(R, m.href, { stage: stageName, categoryId: c.id });
          if (x) all.push(x);
        }
      }
    }
  });
  if (!all.length) throw new Error("Hittade inga matcher i klubbens klasser");

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
  refTeams.forEach((t, i) => {
    const R = refResp[i];
    const RE = (h) => (h && R[h] ? R[h].entity : undefined);
    for (const day of RE(`Referee({id:${t.referee}})$days`) || []) {
      for (const m of day.matches || []) {
        const x = readMatch(R, m.href);
        if (!x) continue;
        const known = all.find((a) => a.id === x.id);
        const mine = x.referees.find((r) => r.id === t.referee);
        push({
          kind: "ref",
          team: t.key,
          ...x,
          stage: known?.stage || "",
          categoryId: known?.categoryId ?? t.categoryId,
          role: mine?.role || "Domare",
        });
      }
    }
  });
  // ... och från klassernas matcher, ifall domarschemat inte är publicerat för dagen än.
  for (const m of all) {
    for (const r of m.referees) {
      if (r.ours) push({ kind: "ref", team: r.ours, ...m, role: r.role || "Domare" });
    }
  }
  events.sort((a, b) => a.start - b.start || `${a.hall}${a.court}`.localeCompare(`${b.hall}${b.court}`));

  const playoffs = all
    .filter((m) => !/grupp/i.test(m.stage))
    .sort((a, b) => a.start - b.start || `${a.hall}${a.court}`.localeCompare(`${b.hall}${b.court}`));

  return { teams, categories, events, playoffs };
}
