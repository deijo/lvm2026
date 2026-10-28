// Lund Volley Masters 2026 – översikt för Habo Wolley
// Hämtar data direkt från Cupmanagers öppna API och visar matcher,
// domaruppdrag och klassens slutspel i tidsordning.

const CONFIG = {
  api: "https://lundvolleymasters.cupmanager.net/rest/results_api/call",
  tournamentId: 74411791,
  categoryId: 74411948, // FU18 (född -10)
  site: "https://lundvolleymasters.cupmanager.net/2026/result",
  // Lägg till fler lag här: id = lagets id i Cupmanager, referee = domar-id.
  teams: [
    { key: "white", label: "White", name: "Habo Wolley White", id: 82397484, referee: 88506314 },
    { key: "red", label: "Red", name: "Habo Wolley Red", id: 82397479, referee: 88506301 },
  ],
  refreshMinutes: 3,
  tz: "Europe/Stockholm",
};

// ---------- API ----------

async function call(query) {
  const url = `${CONFIG.api}?call=${encodeURIComponent(query)}&lang=sv&tournamentId=${CONFIG.tournamentId}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`API svarade ${r.status}`);
  const j = await r.json();
  return j.responses || {};
}

const nm = (n) => {
  if (n == null) return "";
  if (typeof n === "string") return n;
  return n.sv || n.en || Object.values(n)[0] || "";
};

const MATCH_FIELDS =
  "arena:{},home:{team:{}},away:{team:{}},division:{},roundName:{},result:{},referees:[{referee:{}}]";

async function fetchAll() {
  const catQ = `Category({categoryId:${CONFIG.categoryId},tournamentId:${CONFIG.tournamentId}}){stages:[{name:{},divisions:[{... on Division:{matches:[{... on Match:{${MATCH_FIELDS}}}]}}]}]}`;
  const refQ = (id) => `Referee({id:${id}}){... on Referee:{days:[{day:{},matches:[{${MATCH_FIELDS}}]}]}}`;
  const parts = await Promise.all([call(catQ), ...CONFIG.teams.map((t) => call(refQ(t.referee)))]);
  return normalize(parts);
}

// Gör om API-svaren till en enkel lista med händelser och slutspelsmatcher.
function normalize([cat, ...refs]) {
  const teamById = Object.fromEntries(CONFIG.teams.map((t) => [t.id, t]));

  const readMatch = (R, href, extra = {}) => {
    const E = (h) => (h && R[h] ? R[h].entity : undefined);
    const M = E(href);
    if (!M) return null;
    const A = E(M.arena?.href) || {};
    const side = (h) => {
      const a = E(h) || {};
      const tid = a.team?.href ? Number((a.team.href.match(/id:(\d+)/) || [])[1]) : null;
      return { name: nm(a.name), teamId: tid };
    };
    const D = E(M.division?.href) || {};
    const res = E(M.result?.href) || {};
    const round = nm(E(M.roundName?.href)?.name);
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
      round,
      result: {
        finished: !!res.finished || !!M.finished,
        live: !!res.live || !!M.live,
        home: res.homeSetsWon ?? 0,
        away: res.awaySetsWon ?? 0,
      },
      ...extra,
    };
  };

  // Alla matcher i klassen
  const all = [];
  const E = (h) => (h && cat[h] ? cat[h].entity : undefined);
  const stages = E(`Category({categoryId:${CONFIG.categoryId},tournamentId:${CONFIG.tournamentId}})$stages`) || [];
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
  // Lagens egna matcher
  for (const m of all) {
    for (const side of ["home", "away"]) {
      const t = teamById[m[side].teamId];
      if (!t) continue;
      const opp = m[side === "home" ? "away" : "home"];
      events.push({ kind: "match", team: t.key, ...m, opponent: opp.name, us: side });
    }
  }
  // Domaruppdrag
  refs.forEach((R, i) => {
    const t = CONFIG.teams[i];
    const RE = (h) => (h && R[h] ? R[h].entity : undefined);
    for (const day of RE(`Referee({id:${t.referee}})$days`) || []) {
      for (const m of day.matches || []) {
        const roles = RE(`${m.href}$referees`) || [];
        const mine = roles.find((r) => r.referee?.href === `Referee({id:${t.referee}})`);
        const x = readMatch(R, m.href, { role: nm(mine?.positionName) || "Domare" });
        if (x) events.push({ kind: "ref", team: t.key, ...x });
      }
    }
  });
  events.sort((a, b) => a.start - b.start || a.court.localeCompare(b.court));

  const playoffs = all
    .filter((m) => !/grupp/i.test(m.stage))
    .sort((a, b) => a.start - b.start || `${a.hall}${a.court}`.localeCompare(`${b.hall}${b.court}`));

  return { fetched: Date.now(), events, playoffs };
}

// ---------- Visning ----------

const fmt = (opts) => new Intl.DateTimeFormat("sv-SE", { timeZone: CONFIG.tz, ...opts });
const fTime = fmt({ hour: "2-digit", minute: "2-digit" });
const fDayKey = fmt({ year: "numeric", month: "2-digit", day: "2-digit" });
const fDay = fmt({ weekday: "long", day: "numeric", month: "long" });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let state = { data: null, filter: "all", source: "live" };
try {
  state.filter = localStorage.getItem("lvm-filter") || "all";
} catch {}

function groupByDay(list) {
  const out = new Map();
  for (const x of list) {
    const k = fDayKey.format(x.start);
    if (!out.has(k)) out.set(k, { label: cap(fDay.format(x.start)), items: [] });
    out.get(k).items.push(x);
  }
  return [...out.values()];
}

const teamOf = (key) => CONFIG.teams.find((t) => t.key === key);
const ROUNDS = {
  "1/8 final": "åttondelsfinal",
  "1/4 final": "kvartsfinal",
  semifinal: "semifinal",
  "semi final": "semifinal",
  final: "final",
  bronsmatch: "bronsmatch",
};
const roundLabel = (r) => {
  if (!r) return "";
  if (/^\d+-\d+$/.test(r)) return `plats ${r}`;
  return ROUNDS[r.toLowerCase()] || r;
};
const divLabel = (d) => (d || "").replace(/^PLacering/, "Placering");
const phaseLabel = (m) => {
  const div = divLabel(m.division || m.stage);
  if (!m.round || /grupp/i.test(m.stage || m.division) || div.endsWith(m.round)) return div;
  return `${div}, ${roundLabel(m.round)}`;
};

// "Vinn. 31102905" → "Vinnare åttondelsfinal 16:00 plan 3"
let byNr = new Map();
const prettyName = (name, ref) => {
  const mm = /^(Vinn|Förl)\.\s*(\d+)$/.exec(name || "");
  if (!mm) return name;
  const src = byNr.get(mm[2]);
  if (!src) return name;
  const who = mm[1] === "Vinn" ? "Vinnare" : "Förlorare";
  const r = roundLabel(src.round);
  const sameDay = ref && fDayKey.format(ref.start) === fDayKey.format(src.start);
  const day = sameDay ? "" : `${fmt({ weekday: "short" }).format(src.start)} `;
  return `${who} ${r} ${day}${fTime.format(src.start)} plan ${src.court}`;
};
const isHabo = (side) => CONFIG.teams.some((t) => t.id === side.teamId);

function scoreHtml(m) {
  if (m.result.live) return `<span class="score live">Pågår ${m.result.home}–${m.result.away}</span>`;
  if (!m.result.finished) return "";
  return `<span class="score">${m.result.home}–${m.result.away}</span>`;
}

function eventHtml(e, nextId) {
  const t = teamOf(e.team);
  const isNext = `${e.kind}-${e.team}-${e.id}` === nextId;
  const past = e.end < Date.now() && !e.result.live;
  const what =
    e.kind === "match"
      ? `<p class="who">mot <strong>${esc(prettyName(e.opponent, e))}</strong></p>`
      : `<p class="who">${esc(prettyName(e.home.name, e))} – ${esc(prettyName(e.away.name, e))}</p><p class="role">${esc(e.role)}</p>`;
  let score = "";
  if (e.kind === "match" && e.result.finished) {
    const ourSets = e.us === "home" ? e.result.home : e.result.away;
    const theirSets = e.us === "home" ? e.result.away : e.result.home;
    const won = ourSets > theirSets;
    score = `<span class="score ${won ? "won" : "lost"}">${won ? "Vinst" : "Förlust"} ${ourSets}–${theirSets}</span>`;
  } else {
    score = scoreHtml(e);
  }
  return `<li class="event ${e.kind} team-${t.key}${isNext ? " next" : ""}${past ? " past" : ""}">
    <div class="when">
      <span class="time">${fTime.format(e.start)}</span>
      <span class="court"><span class="court-label">Plan</span> ${esc(e.court)}</span>
      <span class="hall">${esc(e.hall)}</span>
    </div>
    <div class="what">
      <div class="tags">
        <span class="kind">${e.kind === "match" ? "Match" : "Döma"}</span>
        <span class="team">${esc(t.label)}</span>
        ${isNext ? '<span class="next-tag">Nästa</span>' : ""}
        ${score}
      </div>
      ${what}
      <p class="phase">${esc(phaseLabel(e))}</p>
    </div>
  </li>`;
}

function render() {
  const { data, filter } = state;
  const scheduleEl = document.getElementById("schedule");
  const playoffEl = document.getElementById("playoffs");
  if (!data) return;
  byNr = new Map(data.playoffs.map((m) => [String(m.nr), m]));

  document.querySelectorAll(".filter button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.filter === filter));
  });

  const events = data.events.filter((e) => filter === "all" || e.team === filter);
  const now = Date.now();
  const next = events.find((e) => e.end > now);
  const nextId = next ? `${next.kind}-${next.team}-${next.id}` : null;

  scheduleEl.innerHTML = events.length
    ? groupByDay(events)
        .map(
          (d) => `<section class="day">
        <h3>${esc(d.label)}</h3>
        <ol class="events">${d.items.map((e) => eventHtml(e, nextId)).join("")}</ol>
      </section>`
        )
        .join("")
    : `<p class="empty">Inga matcher eller domaruppdrag hittades för det här laget.</p>`;

  playoffEl.innerHTML = groupByDay(data.playoffs)
    .map(
      (d) => `<section class="day">
      <h3>${esc(d.label)}</h3>
      <table class="po">
        <thead><tr><th scope="col">Tid</th><th scope="col">Plan</th><th scope="col">Match</th></tr></thead>
        <tbody>${d.items
          .map((m) => {
            const ours = isHabo(m.home) || isHabo(m.away);
            const nameHtml = (s) => (isHabo(s) ? `<strong>${esc(s.name)}</strong>` : esc(prettyName(s.name, m)));
            return `<tr class="${ours ? "ours" : ""}">
            <td class="po-time">${fTime.format(m.start)}</td>
            <td class="po-court">${esc(m.hall)} <b>${esc(m.court)}</b></td>
            <td><span class="po-phase">${esc(phaseLabel(m))}</span>
              <span class="po-teams">${nameHtml(m.home)} – ${nameHtml(m.away)}</span>${scoreHtml(m)}</td>
          </tr>`;
          })
          .join("")}</tbody>
      </table>
    </section>`
    )
    .join("");

  const status = document.getElementById("status");
  const when = fTime.format(data.fetched);
  status.textContent =
    state.source === "live"
      ? `Uppdaterad ${when}`
      : `Turneringens server svarar inte just nu. Visar sparad kopia från ${cap(fDay.format(data.fetched))} ${when}.`;
  status.classList.toggle("warn", state.source !== "live");
}

async function load() {
  const btn = document.getElementById("refresh");
  btn.disabled = true;
  btn.textContent = "Uppdaterar …";
  try {
    state.data = await fetchAll();
    state.source = "live";
  } catch (err) {
    console.warn(err);
    if (!state.data) {
      try {
        const r = await fetch("data/snapshot.json", { cache: "no-store" });
        state.data = await r.json();
      } catch {}
    }
    state.source = "snapshot";
  }
  btn.disabled = false;
  btn.textContent = "Uppdatera";
  render();
}

document.querySelectorAll(".filter button").forEach((b) =>
  b.addEventListener("click", () => {
    state.filter = b.dataset.filter;
    try {
      localStorage.setItem("lvm-filter", state.filter);
    } catch {}
    render();
  })
);
document.getElementById("refresh").addEventListener("click", load);
setInterval(() => {
  if (document.visibilityState === "visible") load();
}, CONFIG.refreshMinutes * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.data && Date.now() - state.data.fetched > 60 * 1000) load();
});

load();
