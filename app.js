// Lund Volley Masters 2026 – översikt för Habo Wolleys lag
// Läser data/schedule.json, som en GitHub Action hämtar från turneringens
// API ungefär var 10:e minut (se scripts/ och .github/workflows/).

const TZ = "Europe/Stockholm";
const RELOAD_MINUTES = 2;
const STALE_MINUTES = 45;

const fmt = (opts) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, ...opts });
const fTime = fmt({ hour: "2-digit", minute: "2-digit" });
const fDayKey = fmt({ year: "numeric", month: "2-digit", day: "2-digit" });
const fDay = fmt({ weekday: "long", day: "numeric", month: "long" });
const fWeekday = fmt({ weekday: "short" });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Filter: "all", "c:<klass-id>" eller "t:<lag-nyckel>"
let state = { data: null, filter: "all", loadedAt: 0, error: false };
try {
  state.filter = localStorage.getItem("lvm-filter2") || "all";
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

const teamOf = (key) => state.data.teams.find((t) => t.key === key);
const catOf = (id) => state.data.categories.find((c) => c.id === id);
const isHabo = (side) => state.data.teams.some((t) => t.id === side.teamId);

// Vilken klass och vilket lag filtret pekar på
function selection() {
  const f = state.filter;
  if (f.startsWith("t:")) {
    const t = teamOf(f.slice(2));
    if (t) return { cat: catOf(t.categoryId), team: t };
  }
  if (f.startsWith("c:")) {
    const c = catOf(Number(f.slice(2)));
    if (c) return { cat: c, team: null };
  }
  return { cat: null, team: null };
}

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
  const sameDay = ref && fDayKey.format(ref.start) === fDayKey.format(src.start);
  const day = sameDay ? "" : `${fWeekday.format(src.start)} `;
  return `${who} ${roundLabel(src.round)} ${day}${fTime.format(src.start)} plan ${src.court}`;
};


// Domarlag för en match, t.ex. "Domare: Borgen VK"
function refereeHtml(m) {
  const list = m.referees || [];
  if (!list.length) return `<p class="refs none">Domare inte tilldelad än</p>`;
  const one = (r) => {
    const role = r.role && r.role !== "Huvuddomare" ? ` (${esc(r.role.toLowerCase())})` : "";
    const name = r.ours ? `<strong>${esc(r.name)} (${esc(teamOf(r.ours).label)})</strong>` : esc(r.name);
    return `${name}${role}`;
  };
  return `<p class="refs">Domare: ${list.map(one).join(", ")}</p>`;
}

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
      ? `<p class="who">mot <strong>${esc(prettyName(e.opponent, e))}</strong></p>${refereeHtml(e)}`
      : `<p class="who">${esc(prettyName(e.home.name, e))} – ${esc(prettyName(e.away.name, e))}</p><p class="role">${esc(e.role)}</p>`;
  let score = scoreHtml(e);
  if (e.kind === "match" && e.result.finished) {
    const ours = e.us === "home" ? e.result.home : e.result.away;
    const theirs = e.us === "home" ? e.result.away : e.result.home;
    const won = ours > theirs;
    score = `<span class="score ${won ? "won" : "lost"}">${won ? "Vinst" : "Förlust"} ${ours}–${theirs}</span>`;
  }
  return `<li class="event ${e.kind} c-${t.color}${isNext ? " next" : ""}${past ? " past" : ""}">
    <div class="when">
      <span class="time">${fTime.format(e.start)}</span>
      ${e.court ? `<span class="court"><span class="court-label">Plan</span> ${esc(e.court)}</span>` : ""}
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

function playoffTable(list) {
  return groupByDay(list)
    .map(
      (d) => `<section class="day">
      <h4>${esc(d.label)}</h4>
      <table class="po">
        <thead><tr><th scope="col">Tid</th><th scope="col">Plan</th><th scope="col">Match</th></tr></thead>
        <tbody>${d.items
          .map((m) => {
            const ours = isHabo(m.home) || isHabo(m.away) || (m.referees || []).some((r) => r.ours);
            const nameHtml = (s) => (isHabo(s) ? `<strong>${esc(s.name)}</strong>` : esc(prettyName(s.name, m)));
            const refs = (m.referees || []).length ? refereeHtml(m) : "";
            return `<tr class="${ours ? "ours" : ""}">
            <td class="po-time">${fTime.format(m.start)}</td>
            <td class="po-court">${esc(m.hall)} <b>${esc(m.court)}</b></td>
            <td><span class="po-phase">${esc(phaseLabel(m))}</span>
              <span class="po-teams">${nameHtml(m.home)} – ${nameHtml(m.away)}</span>${scoreHtml(m)}${refs}</td>
          </tr>`;
          })
          .join("")}</tbody>
      </table>
    </section>`
    )
    .join("");
}

function renderFilters() {
  const { data } = state;
  const { cat, team } = selection();
  const btn = (f, label, pressed) =>
    `<button type="button" data-filter="${esc(f)}" aria-pressed="${pressed}">${esc(label)}</button>`;

  document.getElementById("filter-cats").innerHTML =
    btn("all", "Alla lag", !cat) + data.categories.map((c) => btn(`c:${c.id}`, c.name, cat?.id === c.id)).join("");

  const sub = document.getElementById("filter-teams");
  if (cat && cat.teams.length > 1) {
    sub.hidden = false;
    sub.setAttribute("aria-label", `Lag i ${cat.name}`);
    sub.innerHTML =
      btn(`c:${cat.id}`, `Båda ${cat.name}`, !team) +
      cat.teams.map((k) => btn(`t:${k}`, teamOf(k).label, team?.key === k)).join("");
  } else {
    sub.hidden = true;
    sub.innerHTML = "";
  }
}

function render() {
  const { data } = state;
  if (!data) return;
  byNr = new Map(data.playoffs.map((m) => [`${m.categoryId}:${m.nr}`, m]));
  renderFilters();

  const { cat, team } = selection();
  const keep = (e) => {
    if (team) return e.team === team.key;
    if (cat) return teamOf(e.team).categoryId === cat.id;
    return true;
  };
  const events = data.events.filter(keep);
  const now = Date.now();
  const next = events.find((e) => e.end > now);
  const nextId = next ? `${next.kind}-${next.team}-${next.id}` : null;

  document.getElementById("schedule-title").textContent = team
    ? `${team.label}: matcher och domaruppdrag`
    : cat
      ? `${cat.teams.length > 1 ? `Båda ${cat.name}` : cat.name}: matcher och domaruppdrag`
      : "Alla lagens matcher och domaruppdrag";

  // prettyName behöver veta vilken klass matchnumren hör till
  const withCat = (fn) => (m) => {
    const old = byNr;
    byNr = new Map([...old].filter(([k]) => k.startsWith(`${m.categoryId}:`)).map(([k, v]) => [k.split(":")[1], v]));
    try {
      return fn(m);
    } finally {
      byNr = old;
    }
  };

  document.getElementById("schedule").innerHTML = events.length
    ? groupByDay(events)
        .map(
          (d) => `<section class="day">
        <h3>${esc(d.label)}</h3>
        <ol class="events">${d.items.map(withCat((e) => eventHtml(e, nextId))).join("")}</ol>
      </section>`
        )
        .join("")
    : `<p class="empty">Inga matcher eller domaruppdrag hittades.</p>`;

  const poTitle = document.getElementById("playoffs-title");
  const poLede = document.getElementById("playoffs-lede");
  const poEl = document.getElementById("playoffs");
  const playoffsFor = (c) => data.playoffs.filter((m) => m.categoryId === c.id);
  const tableFor = (c) => {
    const list = playoffsFor(c);
    if (!list.length) return `<p class="empty">Inga slutspelsmatcher publicerade i ${esc(c.name)} än.</p>`;
    return withCat(() => playoffTable(list))({ categoryId: c.id });
  };

  if (cat) {
    poTitle.textContent = `Slutspel ${cat.name}`;
    poLede.textContent = "Alla slutspelsmatcher i klassen. Rader där Habo spelar eller dömer markeras.";
    poEl.innerHTML = tableFor(cat);
  } else {
    poTitle.textContent = "Slutspel";
    poLede.textContent = "Välj en klass ovan, eller öppna en klass här, för att se hela slutspelet.";
    poEl.innerHTML = data.categories
      .map((c) => {
        const list = playoffsFor(c);
        const span = list.length
          ? `${list.length} matcher, ${fWeekday.format(list[0].start)} ${fTime.format(list[0].start)} till ${fWeekday.format(list.at(-1).start)} ${fTime.format(list.at(-1).start)}`
          : "inga matcher publicerade än";
        return `<details class="po-cat"><summary><span class="po-cat-name">${esc(c.name)}</span> <span class="po-cat-meta">${esc(span)}</span></summary>${tableFor(c)}</details>`;
      })
      .join("");
  }

  const nTeams = data.teams.length;
  const nCats = data.categories.length;
  document.getElementById("sub").textContent =
    `Lund Volley Masters, 30 oktober – 1 november 2026. ${nTeams} lag i ${nCats} klasser.`;

  // Kontrolleras normalt var tredje minut; stämpeln sparas minst var 30:e minut.
  const status = document.getElementById("status");
  const when = (t) => {
    const sameDay = fDayKey.format(t) === fDayKey.format(Date.now());
    return sameDay ? fTime.format(t) : `${fWeekday.format(t)} ${fTime.format(t)}`;
  };
  const checked = data.checked || data.changed || 0;
  const stale = !checked || Date.now() - checked > STALE_MINUTES * 60 * 1000;
  if (state.error) {
    status.textContent = `Kunde inte hämta senaste versionen. Visar schemat som senast bekräftades ${checked ? when(checked) : "okänt"}.`;
  } else if (stale) {
    status.textContent = `Schemat har inte bekräftats mot turneringen sedan ${checked ? when(checked) : "okänt"}. Dubbelkolla tider på turneringens sida.`;
  } else {
    status.textContent = `Kontrolleras mot turneringen var tredje minut. Senast bekräftat ${when(checked)}. Senaste ändring ${data.changed ? when(data.changed) : "okänt"}.`;
  }
  status.classList.toggle("warn", state.error || stale);
}

async function load() {
  const btn = document.getElementById("refresh");
  btn.disabled = true;
  btn.textContent = "Uppdaterar …";
  try {
    const r = await fetch(`data/schedule.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`Svar ${r.status}`);
    state.data = await r.json();
    state.loadedAt = Date.now();
    state.error = false;
  } catch (err) {
    console.warn(err);
    state.error = true;
  }
  btn.disabled = false;
  btn.textContent = "Uppdatera";
  if (state.data) render();
  else document.getElementById("status").textContent = "Kunde inte läsa schemat. Försök igen om en stund.";
}

document.querySelector(".filters").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-filter]");
  if (!b) return;
  state.filter = b.dataset.filter;
  try {
    localStorage.setItem("lvm-filter2", state.filter);
  } catch {}
  render();
});
document.getElementById("refresh").addEventListener("click", load);
setInterval(() => {
  if (document.visibilityState === "visible") load();
}, RELOAD_MINUTES * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - state.loadedAt > 60 * 1000) load();
});

load();
