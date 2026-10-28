// Lund Volley Masters 2026 – översikt för Habo Wolley
// Läser data/schedule.json, som en GitHub Action hämtar från turneringens
// API ungefär var 10:e minut (se scripts/ och .github/workflows/).

const TZ = "Europe/Stockholm";
const RELOAD_MINUTES = 2;

const fmt = (opts) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, ...opts });
const fTime = fmt({ hour: "2-digit", minute: "2-digit" });
const fDayKey = fmt({ year: "numeric", month: "2-digit", day: "2-digit" });
const fDay = fmt({ weekday: "long", day: "numeric", month: "long" });
const fWeekday = fmt({ weekday: "short" });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let state = { data: null, filter: "all", loadedAt: 0, error: false };
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

const teamOf = (key) => state.data.teams.find((t) => t.key === key);
const isHabo = (side) => state.data.teams.some((t) => t.id === side.teamId);

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
function refereeHtml(m, { skipOurs } = {}) {
  const list = (m.referees || []).filter((r) => !(skipOurs && r.ours));
  if (!list.length) return skipOurs ? "" : `<p class="refs none">Domare inte tilldelad än</p>`;
  const one = (r) => {
    const role = r.role && r.role !== "Huvuddomare" ? ` (${esc(r.role.toLowerCase())})` : "";
    return `${r.ours ? `<strong>${esc(r.name)}</strong>` : esc(r.name)}${role}`;
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
  if (!data) return;
  byNr = new Map(data.playoffs.map((m) => [String(m.nr), m]));

  document.querySelectorAll(".filter button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.filter === filter));
  });

  const events = data.events.filter((e) => filter === "all" || e.team === filter);
  const now = Date.now();
  const next = events.find((e) => e.end > now);
  const nextId = next ? `${next.kind}-${next.team}-${next.id}` : null;

  document.getElementById("schedule").innerHTML = events.length
    ? groupByDay(events)
        .map(
          (d) => `<section class="day">
        <h3>${esc(d.label)}</h3>
        <ol class="events">${d.items.map((e) => eventHtml(e, nextId)).join("")}</ol>
      </section>`
        )
        .join("")
    : `<p class="empty">Inga matcher eller domaruppdrag hittades för det här laget.</p>`;

  document.getElementById("playoffs").innerHTML = groupByDay(data.playoffs)
    .map(
      (d) => `<section class="day">
      <h3>${esc(d.label)}</h3>
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

  const status = document.getElementById("status");
  const changed = data.changed ? `${cap(fWeekday.format(data.changed))} ${fTime.format(data.changed)}` : "okänt";
  status.textContent = state.error
    ? `Kunde inte hämta senaste versionen. Visar schemat från ${changed}.`
    : `Senaste ändring i turneringens schema: ${changed}. Hämtat ${fTime.format(state.loadedAt)}.`;
  status.classList.toggle("warn", state.error);
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
}, RELOAD_MINUTES * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - state.loadedAt > 60 * 1000) load();
});

load();
