// Sip — Mochi the hydration cat.
// Mochi is an original kawaii character drawn procedurally in SVG; no third-party
// artwork or assets are used anywhere in this app.
"use strict";

const STORE_KEY = "sip_state_v2";
const OLD_KEY = "sip_state_v1";
const REMINDER_GAP_MS = 90 * 60 * 1000;   // escalating nudges, ~90min apart
const DEFAULT_SIZES = [150, 250, 350, 500];

// Tea and coffee hydrate essentially as well as water — the "coffee dehydrates
// you" idea doesn't hold at normal intake — so everything counts fully. The
// type is recorded for interest, not to penalise her.
const DRINK_TYPES = [
  { id: "water", name: "Water", emoji: "💧" },
  { id: "tea", name: "Tea", emoji: "🍵" },
  { id: "coffee", name: "Coffee", emoji: "☕" },
  { id: "juice", name: "Juice", emoji: "🧃" },
];
const TYPE_BY_ID = {};
for (const t of DRINK_TYPES) TYPE_BY_ID[t.id] = t;

/* ---------------------------------------------------------------- state */
function defaultState() {
  return {
    name: null, goalMl: 2000, activeStart: 8, activeEnd: 22,
    drinkSizes: DEFAULT_SIZES.slice(),
    log: [], lastNotified: 0, bestStreak: 0,
    unlocked: ["bow_red", "hat_none", "bg_plain"],
    equipped: { bow: "bow_red", hat: "hat_none", bg: "bg_plain" },
    sound: true, onboarded: false, celebratedOn: null, nextNudgeAt: 0,
    drinkType: "water", seenIntro: false, theme: "auto", goalHistory: [],
  };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    const old = localStorage.getItem(OLD_KEY);   // carry over the v1 pilot data
    if (old) {
      const o = JSON.parse(old);
      return Object.assign(defaultState(), {
        name: o.name, goalMl: o.goalMl, activeStart: o.activeStart, activeEnd: o.activeEnd,
        drinkSizes: o.drinkSizes, log: o.log || [], onboarded: o.onboarded,
      });
    }
  } catch (e) { /* corrupt storage — fall through to a clean slate */ }
  return defaultState();
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  syncStateToSW();
}

/* ---------------------------------------------------------------- dates */
function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

// Day totals are keyed by local midnight rather than dayKey: the key has to be
// numerically comparable so each day can be matched against the goal that was
// actually in force on it (dayKey is unpadded and sorts wrong).
function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayTotals() {
  const m = new Map();
  for (const e of state.log) {
    const k = dayStart(e.ts);
    m.set(k, (m.get(k) || 0) + e.amount);
  }
  return m;
}

function todayTotal() { return dayTotals().get(dayStart(Date.now())) || 0; }
function lastLogTs() { return state.log.length ? state.log[state.log.length - 1].ts : 0; }
function lifetimeMl() { return state.log.reduce((s, e) => s + e.amount, 0); }

/* ----------------------------------------------------------- goal history */
// Judging past days by whatever the goal happens to be today means raising the
// goal silently wipes the streak and every calendar stamp she earned — which
// punishes exactly the ambition the app is meant to encourage. So the goal is
// kept as a timeline and each day is judged by the value in force back then.
// (It also stops the reverse: lowering the goal can't retroactively invent a
// streak she never actually ran.)
function ensureGoalHistory() {
  if (!Array.isArray(state.goalHistory)) state.goalHistory = [];
  const h = state.goalHistory;
  if (!h.length) {
    // Migration for anyone already using the app: treat her whole existing
    // history as having been run at the current goal, so nothing visibly moves
    // the moment this ships.
    const first = state.log.length ? dayStart(state.log[0].ts) : dayStart(Date.now());
    h.push({ from: first, goalMl: state.goalMl });
    return;
  }
  h.sort((a, b) => a.from - b.from);
  // A goal changed outside setGoal (an imported backup, older data) would leave
  // the timeline disagreeing with state.goalMl; record it as changing today
  // rather than rewriting days that already happened.
  if (h[h.length - 1].goalMl !== state.goalMl) setGoal(state.goalMl);
}

function setGoal(goalMl) {
  state.goalMl = goalMl;
  const today = dayStart(Date.now());
  const h = state.goalHistory;
  if (h.length && h[h.length - 1].from === today) h[h.length - 1].goalMl = goalMl;
  else h.push({ from: today, goalMl: goalMl });
}

function goalFor(dayTs) {
  const h = state.goalHistory;
  if (!h || !h.length) return state.goalMl;
  let g = h[0].goalMl;
  for (const entry of h) {
    if (entry.from > dayTs) break;
    g = entry.goalMl;
  }
  return g;
}

function goalDays(totals) {
  let n = 0;
  for (const [day, v] of totals) if (v >= goalFor(day)) n++;
  return n;
}

// One missed day per rolling week is forgiven. Losing a month-long streak to a
// single bad day is the usual reason people quit a streak app for good, and the
// point here is the habit, not the punishment. The forgiven day doesn't add to
// the count — it just doesn't end it.
const GRACE_EVERY_DAYS = 7;

function computeStreak(totals) {
  let streak = 0, lastGrace = -Infinity, pendingGrace = false, forgiven = false;
  const now = new Date();
  for (let i = 0; i < 400; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayTs = dayStart(d.getTime());
    const total = totals.get(dayTs) || 0;
    if (total >= goalFor(dayTs)) {
      streak++;
      // Only a grace that actually bridged two good days counts as forgiveness.
      // The walk always ends on a miss, and spending grace on the blank history
      // before she installed the app must not claim she missed anything.
      if (pendingGrace) { forgiven = true; pendingGrace = false; }
      continue;
    }
    if (i === 0) continue;                        // today is still in progress
    if (i - lastGrace >= GRACE_EVERY_DAYS) {      // spend this week's grace day
      lastGrace = i;
      pendingGrace = true;
      continue;
    }
    break;
  }
  return { streak, forgiven };
}

function weekBars(totals) {
  const out = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayTs = dayStart(d.getTime());
    out.push({
      // Two letters, because single initials collide: Tue/Thu and Sat/Sun both
      // render as one ambiguous letter.
      label: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
      total: totals.get(dayTs) || 0,
      goal: goalFor(dayTs),
    });
  }
  return out;
}

/* ------------------------------------------------------------ wardrobe */
// req is checked against {streak, best, days, ml}; season items appear only
// inside their date window so they feel like a limited-time treat.
const ITEMS = [
  { id: "bow_red",    type: "bow", name: "Ruby",    chip: "🎀", color: "#ff4d7e", req: {} },
  { id: "bow_sky",    type: "bow", name: "Sky",     chip: "🎀", color: "#57b6e8", req: { days: 2 } },
  { id: "bow_mint",   type: "bow", name: "Mint",    chip: "🎀", color: "#4fc9a3", req: { days: 5 } },
  { id: "bow_lilac",  type: "bow", name: "Lilac",   chip: "🎀", color: "#b07ce8", req: { streak: 7 } },
  { id: "bow_dots",   type: "bow", name: "Dots",    chip: "🎀", color: "#ff85ab", req: { streak: 14 }, pattern: "dots" },
  { id: "bow_gold",   type: "bow", name: "Glitter", chip: "✨", color: "#ffc23d", req: { streak: 30 }, pattern: "glitter" },
  { id: "bow_xmas",   type: "bow", name: "Holly",   chip: "🎄", color: "#2e9e5b", req: { season: [11, 1, 11, 31] } },
  { id: "bow_spooky", type: "bow", name: "Spooky",  chip: "🎃", color: "#ff8c20", req: { season: [9, 20, 9, 31] } },
  { id: "bow_love",   type: "bow", name: "Love",    chip: "💗", color: "#ff2d6f", req: { season: [1, 7, 1, 20] }, pattern: "dots" },
  // Long-haul items: without these the wardrobe runs dry around day 30 and the
  // streak stops buying anything, which is where a habit app usually loses her.
  { id: "bow_ocean",  type: "bow", name: "Ocean",   chip: "🎀", color: "#2fa8c9", req: { days: 40 } },
  { id: "bow_star",   type: "bow", name: "Stawwy",  chip: "🎀", color: "#7c6ce8", req: { streak: 45 }, pattern: "stars" },
  { id: "bow_candy",  type: "bow", name: "Candy",   chip: "🎀", color: "#ff6fb5", req: { days: 55 }, pattern: "hearts" },
  { id: "bow_aurora", type: "bow", name: "Auwowa",  chip: "✨", color: "#43d6b5", req: { streak: 60 }, pattern: "glitter" },
  { id: "bow_rose",   type: "bow", name: "Wose",    chip: "🌹", color: "#c9304f", req: { ml: 60000 } },
  { id: "bow_royal",  type: "bow", name: "Woyaw",   chip: "👑", color: "#5b3fd6", req: { streak: 100 }, pattern: "stars" },

  { id: "hat_none",   type: "hat", name: "None",    chip: "🚫", req: {} },
  { id: "hat_flower", type: "hat", name: "Flowers", chip: "🌸", req: { days: 3 } },
  { id: "hat_sun",    type: "hat", name: "Sun hat", chip: "👒", req: { days: 8 } },
  { id: "hat_beanie", type: "hat", name: "Beanie",  chip: "🧢", req: { ml: 25000 } },
  { id: "hat_phones", type: "hat", name: "Phones",  chip: "🎧", req: { days: 20 } },
  { id: "hat_crown",  type: "hat", name: "Crown",   chip: "👑", req: { streak: 21 } },
  { id: "hat_santa",  type: "hat", name: "Santa",   chip: "🎅", req: { season: [11, 1, 11, 31] } },
  { id: "hat_bunny",  type: "hat", name: "Bunny",   chip: "🐰", req: { days: 35 } },
  { id: "hat_star",   type: "hat", name: "Staw",    chip: "⭐", req: { streak: 45 } },
  { id: "hat_moon",   type: "hat", name: "Moon",    chip: "🌙", req: { days: 60 } },
  { id: "hat_wizard", type: "hat", name: "Wizawd",  chip: "🧙", req: { streak: 75 } },
  { id: "hat_halo",   type: "hat", name: "Hawo",    chip: "😇", req: { streak: 150 } },

  { id: "bg_plain",   type: "bg", name: "Plain",    chip: "⬜", req: {} },
  { id: "bg_sky",     type: "bg", name: "Sky",      chip: "☁️", req: { days: 2 } },
  { id: "bg_blossom", type: "bg", name: "Blossom",  chip: "🌸", req: { days: 6 } },
  { id: "bg_forest",  type: "bg", name: "Forest",   chip: "🌲", req: { days: 12 } },
  { id: "bg_night",   type: "bg", name: "Night",    chip: "🌙", req: { streak: 10 } },
  { id: "bg_beach",   type: "bg", name: "Beach",    chip: "🏖️", req: { days: 25 } },
  { id: "bg_sunset",  type: "bg", name: "Sunset",   chip: "🌇", req: { days: 35 } },
  { id: "bg_galaxy",  type: "bg", name: "Gawaxy",   chip: "🌌", req: { streak: 45 } },
  { id: "bg_rainbow", type: "bg", name: "Wainbow",  chip: "🌈", req: { days: 70 } },
  { id: "bg_aurora",  type: "bg", name: "Auwowa",   chip: "🌠", req: { streak: 90 } },
  { id: "bg_cloud9",  type: "bg", name: "Cwoud 9",  chip: "☁️", req: { days: 120 } },
];

const ITEM_BY_ID = {};
for (const it of ITEMS) ITEM_BY_ID[it.id] = it;

function inSeason(req) {
  if (!req.season) return false;
  const [m1, d1, m2, d2] = req.season;
  const now = new Date(), m = now.getMonth(), d = now.getDate();
  const after = m > m1 || (m === m1 && d >= d1);
  const before = m < m2 || (m === m2 && d <= d2);
  return after && before;
}

function reqMet(item, stats) {
  const r = item.req;
  if (r.season) return inSeason(r);
  if (r.streak && stats.best < r.streak) return false;
  if (r.days && stats.days < r.days) return false;
  if (r.ml && stats.ml < r.ml) return false;
  return true;
}

function reqText(item) {
  const r = item.req;
  if (r.season) return "seasonal";
  if (r.streak) return r.streak + "d streak";
  if (r.days) return r.days + " goal days";
  if (r.ml) return (r.ml / 1000) + "L total";
  return "";
}

function refreshUnlocks(stats) {
  const fresh = [];
  for (const it of ITEMS) {
    if (state.unlocked.includes(it.id)) continue;
    if (reqMet(it, stats)) { state.unlocked.push(it.id); fresh.push(it); }
  }
  return fresh;
}

function equippedItem(type) {
  const id = state.equipped[type];
  return ITEM_BY_ID[id] && state.unlocked.includes(id) ? ITEM_BY_ID[id] : null;
}

/* -------------------------------------------------------------- mascot */
// All mascot geometry lives in a 300x250 box: face centre (150,152), ears poking
// out above y=70 so they stay visible instead of being swallowed by the head.
function eyesFor(mood) {
  if (mood === "happy" || mood === "party") {
    return `<g class="m-eyes">
      <path d="M98 152 Q112 134 126 152" stroke="#3c2d37" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M174 152 Q188 134 202 152" stroke="#3c2d37" stroke-width="7" fill="none" stroke-linecap="round"/></g>`;
  }
  if (mood === "sad") {
    return `<g class="m-eyes">
      <path d="M98 142 Q112 160 126 150" stroke="#3c2d37" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M174 150 Q188 160 202 142" stroke="#3c2d37" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M124 158 q7 14 0 21 q-7 -7 0 -21" fill="#8ed6f5" opacity=".9"/></g>`;
  }
  return `<g class="m-eyes"><circle cx="112" cy="146" r="9" fill="#3c2d37"/>
          <circle cx="188" cy="146" r="9" fill="#3c2d37"/>
          <circle cx="115" cy="143" r="2.8" fill="#fff"/><circle cx="191" cy="143" r="2.8" fill="#fff"/></g>`;
}

function bowSVG(item) {
  if (!item) return "";
  const c = item.color, dark = shade(c, -22);
  let deco = "";
  if (item.pattern === "dots") {
    deco = `<circle cx="-22" cy="-6" r="3.2" fill="#fff" opacity=".85"/><circle cx="-13" cy="7" r="3.2" fill="#fff" opacity=".85"/>
            <circle cx="22" cy="-6" r="3.2" fill="#fff" opacity=".85"/><circle cx="13" cy="7" r="3.2" fill="#fff" opacity=".85"/>`;
  } else if (item.pattern === "glitter") {
    deco = `<text x="-26" y="2" font-size="11">✨</text><text x="14" y="4" font-size="11">✨</text>`;
  } else if (item.pattern === "stars") {
    deco = `<text x="-27" y="3" font-size="10">⭐</text><text x="15" y="3" font-size="10">⭐</text>`;
  } else if (item.pattern === "hearts") {
    deco = `<text x="-27" y="3" font-size="10">💗</text><text x="15" y="3" font-size="10">💗</text>`;
  }
  // Sits on the outer edge of the left ear so the ear tip still shows above it.
  return `<g transform="translate(84 80)">
    <polygon points="0,0 -32,-21 -32,21" fill="${c}"/><polygon points="0,0 32,-21 32,21" fill="${c}"/>
    <polygon points="0,0 -32,-21 -27,0" fill="${dark}" opacity=".35"/><polygon points="0,0 32,-21 27,0" fill="${dark}" opacity=".35"/>
    ${deco}<circle r="8.5" fill="${dark}"/></g>`;
}

function hatSVG(item) {
  if (!item) return "";
  switch (item.id) {
    case "hat_flower":
      return [[104, 88], [127, 76], [150, 70], [173, 76], [196, 88]].map((p, i) => {
        const col = ["#ff85ab", "#ffd36e", "#fff", "#b07ce8", "#ff85ab"][i];
        return `<g transform="translate(${p[0]} ${p[1]})">${[0, 72, 144, 216, 288].map(a =>
          `<ellipse cx="0" cy="-6" rx="4.4" ry="6" fill="${col}" transform="rotate(${a})"/>`).join("")}
          <circle r="3.2" fill="#ffc23d"/></g>`;
      }).join("");
    case "hat_sun":
      return `<ellipse cx="150" cy="88" rx="118" ry="24" fill="#ffe0a8"/>
              <path d="M100 88 q6 -54 50 -54 q44 0 50 54 z" fill="#ffeec9"/>
              <path d="M100 84 q50 14 100 0 l0 9 q-50 14 -100 0 z" fill="#ff85ab"/>`;
    case "hat_beanie":
      return `<path d="M72 94 q4 -66 78 -66 q74 0 78 66 z" fill="#7cc4e8"/>
              <rect x="68" y="86" width="164" height="20" rx="10" fill="#a9dcf5"/>
              <circle cx="150" cy="24" r="13" fill="#fff"/>`;
    case "hat_phones":
      return `<path d="M56 120 q0 -94 94 -94 q94 0 94 94" stroke="#ff4d7e" stroke-width="13" fill="none" stroke-linecap="round"/>
              <rect x="38" y="98" width="34" height="54" rx="16" fill="#d92f5e"/>
              <rect x="228" y="98" width="34" height="54" rx="16" fill="#d92f5e"/>`;
    case "hat_crown":
      return `<polygon points="98,86 98,44 124,68 150,28 176,68 202,44 202,86" fill="#ffc23d" stroke="#e8a715" stroke-width="3" stroke-linejoin="round"/>
              <circle cx="150" cy="30" r="5.5" fill="#ff4d7e"/>`;
    case "hat_santa":
      return `<path d="M78 92 q10 -68 78 -64 q58 4 66 38 q-44 36 -144 26 z" fill="#e8354f"/>
              <rect x="70" y="82" width="158" height="21" rx="10.5" fill="#fff"/>
              <circle cx="228" cy="66" r="15" fill="#fff"/>`;
    case "hat_bunny":
      return `<ellipse cx="118" cy="40" rx="15" ry="44" fill="#fff" stroke="#f2b9d1" stroke-width="3"/>
              <ellipse cx="182" cy="40" rx="15" ry="44" fill="#fff" stroke="#f2b9d1" stroke-width="3"/>
              <ellipse cx="118" cy="42" rx="7" ry="31" fill="#ffc5de"/>
              <ellipse cx="182" cy="42" rx="7" ry="31" fill="#ffc5de"/>`;
    case "hat_star":
      return `<path d="M62 96 q88 -44 176 0" stroke="#ffc23d" stroke-width="9" fill="none" stroke-linecap="round"/>
              <polygon points="150,24 158,51 187,51 163,68 172,95 150,78 128,95 137,68 113,51 142,51"
                fill="#ffd95e" stroke="#e8a715" stroke-width="2.5" stroke-linejoin="round"/>`;
    case "hat_moon":
      return `<path d="M62 96 q88 -44 176 0" stroke="#b0a5e8" stroke-width="9" fill="none" stroke-linecap="round"/>
              <path d="M164 26 a30 30 0 1 0 2 56 a24 24 0 1 1 -2 -56 z" fill="#ffe9a8" stroke="#e0c46a" stroke-width="2.5"/>`;
    case "hat_wizard":
      return `<path d="M92 96 L150 10 L208 96 z" fill="#5b3fd6"/>
              <ellipse cx="150" cy="96" rx="68" ry="13" fill="#7c5ce8"/>
              <text x="127" y="72" font-size="17">✨</text>`;
    case "hat_halo":
      return `<ellipse cx="150" cy="34" rx="42" ry="12" fill="none" stroke="#ffe27a" stroke-width="8"/>`;
    default: return "";
  }
}

function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
  return "#" + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)]
    .map(v => v.toString(16).padStart(2, "0")).join("");
}

function mochiSVG(mood) {
  const bow = equippedItem("bow"), hat = equippedItem("hat");
  const blush = (mood === "happy" || mood === "party")
    ? `<ellipse cx="96" cy="176" rx="16" ry="9.5" fill="#ffa3c2" opacity=".7"/>
       <ellipse cx="204" cy="176" rx="16" ry="9.5" fill="#ffa3c2" opacity=".7"/>` : "";
  // A pink outline keeps the white cat readable on both the plain white card
  // and the dark "night" scene.
  const OL = `stroke="#f2b9d1" stroke-width="3.5" stroke-linejoin="round"`;
  // Ears and whiskers sit in their own transform groups (rather than as loose
  // shapes in m-body) purely so CSS can twitch each one independently — the SVG
  // output is otherwise unchanged, so hats/bows still line up exactly as before.
  return `<svg viewBox="0 0 300 250" xmlns="http://www.w3.org/2000/svg"><g class="m-body">
    <g class="m-ear-l"><polygon points="70,106 100,28 130,110" fill="#fff" ${OL}/>
      <polygon points="82,100 100,48 118,102" fill="#ffc5de"/></g>
    <g class="m-ear-r"><polygon points="170,110 200,28 230,106" fill="#fff" ${OL}/>
      <polygon points="182,102 200,48 218,100" fill="#ffc5de"/></g>
    <ellipse cx="150" cy="152" rx="100" ry="80" fill="#fff" ${OL}/>
    <g class="m-whiskers-l" stroke="#d9b3c1" stroke-width="3" stroke-linecap="round">
      <line x1="14" y1="142" x2="80" y2="148"/><line x1="10" y1="162" x2="78" y2="162"/><line x1="14" y1="182" x2="80" y2="176"/>
    </g>
    <g class="m-whiskers-r" stroke="#d9b3c1" stroke-width="3" stroke-linecap="round">
      <line x1="286" y1="142" x2="220" y2="148"/><line x1="290" y1="162" x2="222" y2="162"/><line x1="286" y1="182" x2="220" y2="176"/>
    </g>
    ${blush}${eyesFor(mood)}
    <ellipse cx="150" cy="172" rx="13" ry="8" fill="#ffc23d"/>
    ${hatSVG(hat)}${bowSVG(bow)}
  </g></svg>`;
}

/* -------------------------------------------------------------- bottle */
const BOTTLE_TOP = 62, BOTTLE_BOT = 286, BOTTLE_H = BOTTLE_BOT - BOTTLE_TOP;

function bottleSVG() {
  const bow = equippedItem("bow");
  const bc = bow ? bow.color : "#ff4d7e";
  return `<svg viewBox="0 0 200 310" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="bodyClip"><rect x="34" y="${BOTTLE_TOP}" width="132" height="${BOTTLE_H}" rx="40"/></clipPath>
      <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ff9ec4"/><stop offset="1" stop-color="#ff5f92"/>
      </linearGradient>
    </defs>
    <rect x="74" y="8" width="52" height="30" rx="11" fill="#ffb3d0"/>
    <rect x="80" y="34" width="40" height="30" fill="#ffe6f0"/>
    <rect x="34" y="${BOTTLE_TOP}" width="132" height="${BOTTLE_H}" rx="40" fill="#ffe6f0"/>
    <g clip-path="url(#bodyClip)">
      <g id="waterG" transform="translate(0 ${BOTTLE_H})">
        <g class="wave-scroll">
          <path d="M-100,14 Q-75,0 -50,14 T0,14 T50,14 T100,14 T150,14 T200,14 T250,14 T300,14 L300,320 L-100,320 Z" fill="url(#wg)"/>
        </g>
      </g>
    </g>
    <rect x="34" y="${BOTTLE_TOP}" width="132" height="${BOTTLE_H}" rx="40" fill="none" stroke="#ffb3d0" stroke-width="6"/>
    <rect x="52" y="92" width="13" height="86" rx="6.5" fill="#fff" opacity=".55"/>
    <g transform="translate(100 62)">
      <polygon points="0,0 -30,-19 -30,19" fill="${bc}"/><polygon points="0,0 30,-19 30,19" fill="${bc}"/>
      <circle r="8" fill="${shade(bc, -22)}"/>
    </g>
  </svg>`;
}

function setWater(pct) {
  const g = document.getElementById("waterG");
  if (g) g.setAttribute("transform", `translate(0 ${BOTTLE_H * (1 - Math.min(1, pct))})`);
}

/* ---------------------------------------------------------------- copy */
// {n} is swapped for whatever name she enters at onboarding, so no personal
// name is baked into the source.
const LINES = {
  party: [
    "Wa-hoo!! You did it, {n}! 🎉", "Mochi is SO pwoud of you! 🥰", "Bestest dwinking evew, {n}! ✨",
    "Goaw compwete! Mochi is dancing! 💃", "You dwank it aww, {n}! 🏆",
    "Mochi's heawt is so fuww wight now! 💖", "Suchhh a good hooman! 🎀",
    "We did it togethew, {n}! 🥳", "Mochi is doing a happy wiggwe! 🎊",
    "Aww that watew! Mochi is amazed! 😻", "{n} is the vewy best, no contest! 👑",
    "Mochi wants to cewebwate with you! 🎉",
  ],
  happy: [
    "Nom nom, watew is yummy! 💕", "Yay {n}! Suchhh a good sip! 🎀", "Mochi feews aww bubbwy now! 🫧",
    "That was a pewfect sip! ✨", "Mochi is so happy wight now! 😊",
    "Gwug gwug! Mowe pwease! 💧", "{n} is taking suchhh good cawe! 🥰",
    "Mochi's tummy is aww happy! 💕", "Wovewy wittle dwink! 🎀",
    "Mochi did a happy wiggwe! 🐱", "You'we doing gweat, {n}! 🌟",
    "Mochi feews aww spawkwy! ✨",
  ],
  neutral: [
    "Mochi wants a wittle sip pwease! 🥺", "{n}, sippy sip? Mochi is waiting! 🎀", "Watew time, pwetty pwease? 💧",
    "Mochi is just sitting hewe... 👀", "Maybe a wittle dwink, {n}? 🥤",
    "Mochi's cup is wooking empty! 🥛", "Psssst... {n}... watew? 💧",
    "A tiny sip wouwd be so nice! 🎀", "Mochi is being vewy patient! 😌",
    "Don't fowget to dwink, {n}! 💕", "Mochi is thinking about watew... 💭",
    "Just one wittle sip? 🥺",
  ],
  sad: [
    "{n}... Mochi is vewy thirsty... 🥺", "Y-you forgot Mochi... *sniff* 😿", "So dwy... needs watew... 💔",
    "Mochi has been waiting so wong... 😢", "*sad wittle meow* 😿",
    "{n}, did you fowget about Mochi? 💔", "Mochi's whiskews awe aww dwoopy... 😔",
    "It's been fowevew, {n}... 🥺", "Mochi weawwy needs watew pwease... 💧",
    "So vewy thirsty... hewp? 😿", "Mochi misses youw sips... 💔",
    "*tiny thirsty noises* 🥺",
  ],
};

// Situational lines outrank the plain mood pools so Mochi reacts to what just
// happened instead of drawing at random. First match wins, so these are ordered
// most-specific first. `chance` keeps the ambient ones (time of day) from
// crowding the mood lines out entirely; the rare earned moments always fire.
const SITUATIONS = [
  { chance: 1, when: c => c.newBest, lines: [
    "{n}!! That's youw best stweak EVEW! 🏆", "New wecowd! {s} days! Mochi is amazed! 🤩",
    "Nobody stweaks wike you, {n}! ✨", "Best stweak evew! Mochi is shook! 😻",
  ] },
  { chance: 1, when: c => c.comeback, lines: [
    "{n}! You came back! Mochi missed you! 🥹", "Mochi waited and waited... hewwo! 💕",
    "Thewe you awe! Mochi was wonewy! 🎀", "Wewcome back, {n}! Wet's dwink! ✨",
  ] },
  { chance: 1, when: c => c.firstToday, lines: [
    "Fiwst sip of the day! 🎀", "Yay! {n}'s vewy fiwst dwink! ☀️",
    "Stawting the day wight! Mochi appwoves! 💕", "Fiwst one down, many mowe to go! 💧",
  ] },
  { chance: 1, when: c => c.toGo > 0 && c.toGo <= 250, lines: [
    "Sooo cwose, {n}! Just a bit mowe! 🔥", "Almost thewe! Mochi can feew it! ✨",
    "One mowe sip and we did it! 🎯", "{n}, the goaw is wight thewe! 👀",
  ] },
  { chance: .7, when: c => c.type === "tea", lines: [
    "Tea time! Mochi wuvs the smeww! 🍵", "Cozy wittle tea sip! 🫖", "Tea counts too, {n}! 💕",
  ] },
  { chance: .7, when: c => c.type === "coffee", lines: [
    "Coffee! Mochi feews awake now! ☕", "Zoom zoom coffee sip! ⚡", "Coffee is watew too, {n}! 💕",
  ] },
  { chance: .7, when: c => c.type === "juice", lines: [
    "Juicy! Mochi wikes this one! 🧃", "Sweet wittle sip! 🍊", "Juice is yummy, {n}! 💕",
  ] },
  { chance: .45, when: c => c.streak >= 7, lines: [
    "{s} days in a wow, {n}! Mochi is impwessed! 🔥", "Stweak of {s}! Unstoppabwe! ⚡",
    "{s} whowe days! Mochi is so pwoud! 💖",
  ] },
  { chance: .5, when: c => c.hour >= 22 || c.hour < 5, lines: [
    "Sleepy sip! Don't stay up too wate, {n}! 🌙", "Mochi is getting sweepy... 😴",
    "Wate night watew! Mochi appwoves! ⭐", "Shhh... quiet wittle night sip! 🌛",
  ] },
  { chance: .4, when: c => c.hour >= 5 && c.hour < 11, lines: [
    "Good mowning, {n}! 🌅", "Mochi woke up thinking about watew! ☀️",
    "Mowning sips awe the best sips! 🐦",
  ] },
];
// three escalation tiers, matched to how long the bottle has sat untouched
const NUDGES = [
  ["{n}, sippy sip time? 🎀", "Mochi wants watew pwease! 💧", "Just a wittle dwink, {n}? 🥺"],
  ["Mochi is getting vewy thirsty... 🥺", "It's been soooo wong, {n}! *sniff* 😿", "Pwease don't forget Mochi! 💔"],
  ["MOCHI IS DYING OF THIRST!! 😭", "Hewwo {n}?? Watew?? Pwease?? 😾", "Mochi has been waiting fowevew... 💧💔"],
];

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function fill(s, ctx) {
  return s.replace(/\{n\}/g, state.name || "cutie")
          .replace(/\{s\}/g, ctx && ctx.streak != null ? String(ctx.streak) : "");
}
function line(arr, ctx) { return fill(pick(arr), ctx); }

// `justLogged` is inferred from how recently the newest entry landed, so opening
// the app hours later falls back to a plain mood line instead of congratulating
// her on a drink she has long since forgotten about.
function lineContext(total, mood, streak, newBest) {
  const now = Date.now();
  const today = dayKey(now);
  const last = state.log[state.log.length - 1];
  const prev = state.log[state.log.length - 2];
  let todayCount = 0;
  for (const e of state.log) if (dayKey(e.ts) === today) todayCount++;
  return {
    mood, streak, newBest,
    hour: new Date(now).getHours(),
    toGo: Math.max(0, state.goalMl - total),
    firstToday: todayCount === 1,
    comeback: !!(last && prev && last.ts - prev.ts > 36 * 3600000),
    type: last && now - last.ts < 60000 ? last.type : null,
  };
}

function lineFor(ctx) {
  for (const s of SITUATIONS) {
    if (!s.when(ctx)) continue;
    if (s.chance < 1 && Math.random() > s.chance) continue;
    return line(s.lines, ctx);
  }
  return line(LINES[ctx.mood], ctx);
}

function moodFor(total) {
  if (total >= state.goalMl) return "party";
  const last = lastLogTs();
  if (!last) return "neutral";      // never guilt-trip someone on their first open
  const hrs = (Date.now() - last) / 3600000;
  if (hrs < 0.5) return "happy";
  if (hrs > 2.5) return "sad";
  return "neutral";
}

/* --------------------------------------------------------------- audio */
let actx = null;
function playPop() {
  if (!state.sound) { buzz(25); return; }
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const t = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(380, t);
    o.frequency.exponentialRampToValueAtTime(1150, t + 0.09);   // rising bubble "pop"
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + 0.2);
  } catch (e) {}
  buzz(25);
}
function buzz(ms) { if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }

/* ------------------------------------------------------------- render */
const $ = (id) => document.getElementById(id);

function render(opts) {
  opts = opts || {};
  const totals = dayTotals();
  const { streak, forgiven } = computeStreak(totals);
  const stats = { streak, best: Math.max(streak, state.bestStreak), days: goalDays(totals), ml: lifetimeMl() };
  // Captured before bestStreak is overwritten below. Requires a previous best so
  // her very first day reads as a start, not as beating a record of zero.
  const newBest = state.bestStreak > 0 && streak > state.bestStreak;
  if (streak > state.bestStreak) state.bestStreak = streak;

  const fresh = refreshUnlocks(stats);
  if (fresh.length) { saveState(); showUnlock(fresh[0]); }

  // dayTotals() is keyed by dayStart (a number), not dayKey (a string) — looking
  // it up with the wrong key type silently yields undefined, which reads as a
  // zero total and blanks the whole screen.
  const total = totals.get(dayStart(Date.now())) || 0;
  const mood = moodFor(total);

  $("greetText").textContent = "Hi, " + (state.name || "cutie") + " 🎀";
  $("totalMl").textContent = total;
  $("goalMl").textContent = state.goalMl;
  const left = Math.max(0, state.goalMl - total);
  $("remainText").textContent = left ? left + " ml to go!" : "Goaw compwete! 🎉";
  $("streakNum").textContent = streak;
  $("streakBest").textContent = state.bestStreak ? "best " + state.bestStreak : "";
  $("graceNote").classList.toggle("hidden", !(forgiven && streak > 0));

  const slot = $("mascotSlot");
  slot.innerHTML = mochiSVG(mood);
  slot.className = "mascot-slot big" + (mood === "sad" ? " sad" : mood === "party" ? " party" : "");
  if (opts.react) {
    void slot.offsetWidth;                       // restart the pop animation
    slot.classList.add("react");
    setTimeout(() => slot.classList.remove("react"), 620);
  }
  if (!opts.keepLine) $("mascotLine").textContent = lineFor(lineContext(total, mood, streak, newBest));

  const bg = equippedItem("bg");
  $("mascotCard").className = "mascot-card" + (bg && bg.id !== "bg_plain" ? " scene-" + bg.id.slice(3) : "");

  if (!$("bottleSlot").firstChild || opts.rebuildBottle) $("bottleSlot").innerHTML = bottleSVG();
  requestAnimationFrame(() => setWater(total / state.goalMl));

  renderTypes();
  renderDrinkButtons();
  renderTodayLog();
  renderWardrobe(stats);
  renderChart(weekBars(totals));
  renderCalendar(totals);
  $("notifCard").classList.toggle("hidden", notifSettled());
}

function renderTypes() {
  $("typeRow").innerHTML = DRINK_TYPES.map(t =>
    `<button class="type-btn ${state.drinkType === t.id ? "on" : ""}" data-type="${t.id}">${t.emoji} ${t.name}</button>`
  ).join("");
  $("typeRow").querySelectorAll(".type-btn").forEach(b => b.addEventListener("click", () => {
    state.drinkType = b.dataset.type;
    saveState();
    buzz(12);
    render({ keepLine: true });
  }));
}

// Tap logs the preset; press and hold opens a custom amount. Holding keeps the
// home screen uncluttered instead of adding a fifth button to a cramped row.
const HOLD_MS = 500;

function renderDrinkButtons() {
  const emoji = (TYPE_BY_ID[state.drinkType] || TYPE_BY_ID.water).emoji;
  $("drinkButtons").innerHTML = state.drinkSizes.map(a =>
    `<button class="drink-btn" data-amt="${a}"><span class="emoji">${emoji}</span><span class="amt">${a}ml</span></button>`
  ).join("");

  $("drinkButtons").querySelectorAll(".drink-btn").forEach(b => {
    const amt = Number(b.dataset.amt);
    let timer = null, held = false;
    const start = () => {
      held = false;
      clearTimeout(timer);
      timer = setTimeout(() => { held = true; buzz(20); openCustom(amt); }, HOLD_MS);
    };
    const stop = () => clearTimeout(timer);
    b.addEventListener("pointerdown", start);
    ["pointerup", "pointerleave", "pointercancel"].forEach(e => b.addEventListener(e, stop));
    b.addEventListener("contextmenu", e => e.preventDefault());
    b.addEventListener("click", () => {
      if (held) { held = false; return; }        // the hold already opened the sheet
      logDrink(amt);
    });
  });
}

function openCustom(preset) {
  $("customAmt").value = preset;
  $("customSheet").classList.remove("hidden");
}

function initCustom() {
  const amtEl = () => $("customAmt");
  $("customCancel").addEventListener("click", () => $("customSheet").classList.add("hidden"));
  $("customSheet").querySelectorAll(".quick-btn").forEach(b => b.addEventListener("click", () => {
    const v = Math.max(10, Math.min(3000, (Number(amtEl().value) || 0) + Number(b.dataset.add)));
    amtEl().value = v;
    buzz(10);
  }));
  $("customOk").addEventListener("click", () => {
    const v = Math.round(Number(amtEl().value) || 0);
    if (!(v >= 10 && v <= 3000)) { showToast("Pick between 10 and 3000 ml 🥺"); return; }
    $("customSheet").classList.add("hidden");
    logDrink(v);
  });
}

// Bows all share the 🎀 glyph, so draw a real swatch in the item's own colour —
// otherwise every bow in the drawer looks identical.
function chipHTML(item) {
  if (item.type !== "bow") return item.chip;
  const d = shade(item.color, -22);
  return `<svg viewBox="0 0 40 26" width="27" height="18" aria-hidden="true">
    <polygon points="20,13 4,3 4,23" fill="${item.color}"/><polygon points="20,13 36,3 36,23" fill="${item.color}"/>
    <circle cx="20" cy="13" r="4.6" fill="${d}"/></svg>`;
}

function renderWardrobe(stats) {
  for (const [type, rowId] of [["bow", "rowBow"], ["hat", "rowHat"], ["bg", "rowBg"]]) {
    const items = ITEMS.filter(i => i.type === type)
      .filter(i => !i.req.season || inSeason(i.req) || state.unlocked.includes(i.id));
    $(rowId).innerHTML = items.map(i => {
      const un = state.unlocked.includes(i.id);
      const eq = state.equipped[type] === i.id;
      return `<button class="ward-item ${un ? "" : "locked"} ${eq ? "equipped" : ""}" data-type="${type}" data-id="${i.id}">
        <span class="chip">${un ? chipHTML(i) : "🔒"}</span><span class="cap">${un ? i.name : reqText(i)}</span></button>`;
    }).join("");
    $(rowId).querySelectorAll(".ward-item").forEach(b => b.addEventListener("click", () => {
      const it = ITEM_BY_ID[b.dataset.id];
      if (!state.unlocked.includes(it.id)) { showToast("Wocked! " + reqText(it) + " to unwock 🔒"); return; }
      state.equipped[b.dataset.type] = it.id;
      saveState(); buzz(15);
      render({ keepLine: true, rebuildBottle: true });
    }));
  }
}

function renderChart(days) {
  const max = Math.max(state.goalMl, ...days.map(d => d.total)) || 1;
  const barW = 28, gap = (320 - barW * 7) / 8;
  // The dashed line marks today's goal; each bar is still judged against the
  // goal that applied on its own day.
  const goalY = 96 - (state.goalMl / max) * 86;
  let svg = `<line x1="0" y1="${goalY}" x2="320" y2="${goalY}" stroke="#ff4d7e" stroke-width="1.5" stroke-dasharray="5 5" opacity=".6"/>`;
  days.forEach((d, i) => {
    const x = gap + i * (barW + gap);
    const h = Math.max(5, (d.total / max) * 86), y = 96 - h;
    const hit = d.total >= d.goal;
    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="9" fill="${hit ? "#ff4d7e" : "#ffd0e2"}"/>`;
    if (hit) svg += `<text x="${x + barW / 2}" y="${y - 5}" font-size="11" text-anchor="middle">✨</text>`;
    svg += `<text x="${x + barW / 2}" y="112" font-size="11" fill="#8f6474" font-weight="700" text-anchor="middle">${d.label}</text>`;
  });
  $("weekChart").innerHTML = svg;
}

/* ------------------------------------------------------------ actions */
function logDrink(amount, type) {
  const before = todayTotal();
  state.log.push({ ts: Date.now(), amount, type: type || state.drinkType || "water" });
  if (state.log.length > 5000) state.log = state.log.slice(-5000);
  state.lastNotified = Date.now();
  state.nextNudgeAt = 0;                 // a real drink outranks any snooze
  saveState();
  playPop();
  sparkle();
  render({ react: true });
  if (NATIVE) scheduleNative();          // push the next alarm out from this drink
  const after = todayTotal();
  if (after >= state.goalMl && before < state.goalMl && state.celebratedOn !== dayKey(Date.now())) {
    state.celebratedOn = dayKey(Date.now());
    saveState();
    celebrate();
  }
}

// Removing by index into state.log rather than by timestamp: two taps inside the
// same millisecond would otherwise be indistinguishable and delete the wrong one.
function removeEntry(idx) {
  if (idx < 0 || idx >= state.log.length) return;
  const gone = state.log[idx];
  const hadCelebrated = state.celebratedOn;
  state.log.splice(idx, 1);
  // A mis-tap that had pushed her over the goal should let the celebration fire
  // again once she genuinely gets there.
  if (todayTotal() < state.goalMl && state.celebratedOn === dayKey(Date.now())) {
    state.celebratedOn = null;
  }
  state.nextNudgeAt = 0;
  saveState();
  buzz(15);
  render();
  if (daySheetTs !== null) renderDaySheet();
  if (NATIVE) scheduleNative();          // the last-drink time may have moved
  showUndo("Wemoved " + gone.amount + "ml 💧", gone, hadCelebrated);
}

// Undo rather than a confirm dialog: deleting a mis-tap is common enough that a
// prompt every time would be its own annoyance, and the tap target is small.
let pendingUndo = null;

function showUndo(msg, entry, celebratedOn) {
  pendingUndo = { entry, celebratedOn };
  $("undoText").textContent = msg;
  $("undoToast").classList.remove("hidden");
  clearTimeout(showUndo._h);
  showUndo._h = setTimeout(hideUndo, 6000);
}

function hideUndo() {
  pendingUndo = null;
  $("undoToast").classList.add("hidden");
}

function undoRemove() {
  if (!pendingUndo) return;
  const { entry, celebratedOn } = pendingUndo;
  state.log.push(entry);
  state.log.sort((a, b) => a.ts - b.ts);   // a restored past drink must sit back in order
  state.celebratedOn = celebratedOn;
  state.nextNudgeAt = 0;
  hideUndo();
  saveState();
  buzz(15);
  render();
  if (daySheetTs !== null) renderDaySheet();
  if (NATIVE) scheduleNative();
}

function renderTodayLog() {
  const today = dayKey(Date.now());
  const rows = [];
  state.log.forEach((e, i) => { if (dayKey(e.ts) === today) rows.push({ e, i }); });
  rows.reverse();                        // newest first, where a mis-tap will be

  if (!rows.length) {
    $("logList").innerHTML = `<p class="log-empty">Nothing yet today — tap a cup! 🎀</p>`;
    return;
  }

  $("logList").innerHTML = rows.map(({ e, i }) => {
    const t = TYPE_BY_ID[e.type] || TYPE_BY_ID.water;
    const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `<div class="log-row">
      <span class="l-emoji">${t.emoji}</span>
      <span class="l-amt">${e.amount}ml</span>
      <span class="l-time">${time}</span>
      <button class="log-del" data-idx="${i}" aria-label="Remove ${e.amount}ml">×</button>
    </div>`;
  }).join("");

  $("logList").querySelectorAll(".log-del").forEach(b =>
    b.addEventListener("click", () => removeEntry(Number(b.dataset.idx))));
}

/* --------------------------------------------------------------- backup */
// Everything lives in localStorage with no server copy, so a manual export is
// the only thing standing between a cleared browser and a lost streak.
function exportBackup() {
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sip-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Backup saved! 💾");
  } catch (e) { showToast("Couldn't save the backup 😿"); }
}

function importBackup(file) {
  const r = new FileReader();
  r.onload = () => {
    let data;
    try { data = JSON.parse(r.result); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.log)) { showToast("That file didn't wook wight 😿"); return; }
    const when = data.log.length ? new Date(data.log[data.log.length - 1].ts).toLocaleDateString() : "empty";
    if (!confirm("Restore this backup (last drink: " + when + ")?\n\nIt replaces what is currently on this phone.")) return;
    state = Object.assign(defaultState(), data);
    ensureGoalHistory();      // older backups predate the goal timeline
    saveState();
    render({ rebuildBottle: true });
    showToast("Westored! 🎀");
  };
  r.onerror = () => showToast("Couldn't wead that file 😿");
  r.readAsText(file);
}

function sparkle() {
  const layer = $("sparkleLayer");
  for (let i = 0; i < 5; i++) {
    const s = document.createElement("span");
    s.className = "sparkle";
    s.textContent = pick(["✨", "💕", "🫧", "💧", "🎀"]);
    s.style.left = (18 + Math.random() * 64) + "%";
    s.style.top = (35 + Math.random() * 35) + "%";
    s.style.animationDelay = (i * 0.07) + "s";
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1400);
  }
}

// A tap directly on Mochi (separate from logging a drink) is pure affection —
// no state changes, no stats, nothing to unlock. Scoped to the main screen's
// mascot only: the onboarding/intro/celebrate cats are transient and passed
// through quickly, so petting there would rarely be seen.
const PET_LINES = [
  "Mochi puwws so happiwy! 😻", "Aww, wight thewe! 💕",
  "Mochi weans into youw hand! 🥰", "So many pets! Mochi is mewting! 💖",
];

function petMascot() {
  const slot = $("mascotSlot");
  void slot.offsetWidth;                        // restart the animation on repeat taps
  slot.classList.add("petted");
  setTimeout(() => slot.classList.remove("petted"), 700);
  buzz(10);
  petSparkle();
  $("mascotLine").textContent = line(PET_LINES);
}

function petSparkle() {
  const layer = $("sparkleLayer");
  for (let i = 0; i < 4; i++) {
    const s = document.createElement("span");
    s.className = "sparkle";
    s.textContent = pick(["💕", "💗", "✨"]);
    s.style.left = (18 + Math.random() * 64) + "%";
    s.style.top = (30 + Math.random() * 30) + "%";
    s.style.animationDelay = (i * 0.06) + "s";
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1400);
  }
}

function initPet() {
  const slot = $("mascotSlot");
  if (slot) slot.addEventListener("click", petMascot);
}

function celebrate() {
  $("celebrateMascot").innerHTML = mochiSVG("party");
  $("celebrateMascot").className = "mascot-slot big party";
  $("celebrateLine").textContent = line(LINES.party);
  $("celebrate").classList.remove("hidden");
  buzz([40, 60, 40]);
  for (let i = 0; i < 26; i++) {
    const c = document.createElement("span");
    c.className = "confetti";
    c.textContent = pick(["🎀", "✨", "💕", "🫧", "🎉"]);
    c.style.left = Math.random() * 100 + "vw";
    c.style.animationDuration = (1.6 + Math.random() * 1.4) + "s";
    c.style.animationDelay = (Math.random() * 0.5) + "s";
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3600);
  }
}

/* ------------------------------------------------------------ calendar */
let calMonth = null;   // first day of the month currently on screen

// Built from the locale so the calendar header and the week chart agree. Jan 1
// 2024 was a Monday, which is where the week starts here.
const DOW_LABELS = (() => {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(2024, 0, 1 + i);
    out.push(d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2));
  }
  return out;
})();

function renderCalendar(totals) {
  if (!calMonth) { calMonth = new Date(); calMonth.setDate(1); calMonth.setHours(0, 0, 0, 0); }
  const y = calMonth.getFullYear(), m = calMonth.getMonth();

  $("calTitle").textContent = calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("calDow").innerHTML = DOW_LABELS.map(d => `<span>${d}</span>`).join("");

  const lead = (new Date(y, m, 1).getDay() + 6) % 7;      // weeks start Monday
  const days = new Date(y, m + 1, 0).getDate();
  const todayTs = dayStart(Date.now());
  let html = "", hits = 0, ml = 0;

  for (let i = 0; i < lead; i++) html += `<div class="cal-day blank"></div>`;
  for (let d = 1; d <= days; d++) {
    const k = dayStart(new Date(y, m, d).getTime());
    const t = totals.get(k) || 0;
    const hit = t >= goalFor(k);
    if (hit) hits++;
    ml += t;
    const future = k > todayTs;
    const cls = (hit ? "hit" : (t > 0 ? "part" : "")) + (future ? " future" : "");
    // Only past and present days are tappable; data-ts is what the delegated
    // handler keys off, so future cells simply carry none.
    html += `<div class="cal-day ${cls}${k === todayTs ? " today" : ""}"` +
            (future ? "" : ` data-ts="${k}" role="button" tabindex="0" aria-label="Edit ${d}"`) + ">" +
            `<span>${d}</span>${hit ? '<span class="stamp">🎀</span>' : ""}</div>`;
  }

  $("calGrid").innerHTML = html;
  $("calSum").textContent = hits + " goaw day" + (hits === 1 ? "" : "s") + " · " + (ml / 1000).toFixed(1) + " L";

  const now = new Date();
  $("calNext").disabled = (y === now.getFullYear() && m === now.getMonth());
}

function initCalendar() {
  const shift = n => {
    if (!calMonth) return;
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1);
    renderCalendar(dayTotals());
  };
  $("calPrev").addEventListener("click", () => shift(-1));
  $("calNext").addEventListener("click", () => shift(1));
  // Delegated: the grid is rebuilt on every render, so per-cell listeners would
  // have to be reattached each time.
  $("calGrid").addEventListener("click", e => {
    const cell = e.target.closest(".cal-day[data-ts]");
    if (cell) openDay(Number(cell.dataset.ts));
  });
}

/* ------------------------------------------------------- day editor sheet */
// Forgetting to log is the normal case, and until now a missed drink was simply
// unrecoverable — which could cost her a streak she had actually earned.
let daySheetTs = null;

function openDay(dayTs) {
  if (dayTs > dayStart(Date.now())) return;   // nothing to record in the future
  daySheetTs = dayTs;
  renderDaySheet();
  $("daySheet").classList.remove("hidden");
}

function closeDay() {
  daySheetTs = null;
  $("daySheet").classList.add("hidden");
}

function renderDaySheet() {
  const ts = daySheetTs;
  if (ts === null) return;
  const d = new Date(ts);
  const isToday = ts === dayStart(Date.now());
  $("dayTitle").textContent = isToday
    ? "Today"
    : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  const rows = [];
  state.log.forEach((e, i) => { if (dayStart(e.ts) === ts) rows.push({ e, i }); });
  const total = rows.reduce((s, r) => s + r.e.amount, 0);
  const goal = goalFor(ts);
  $("daySummary").textContent = total + " / " + goal + " ml" + (total >= goal ? "  🎀" : "");

  rows.reverse();
  $("dayList").innerHTML = rows.length
    ? rows.map(({ e, i }) => {
        const t = TYPE_BY_ID[e.type] || TYPE_BY_ID.water;
        const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return `<div class="log-row">
          <span class="l-emoji">${t.emoji}</span>
          <span class="l-amt">${e.amount}ml</span>
          <span class="l-time">${time}</span>
          <button class="log-del" data-idx="${i}" aria-label="Remove ${e.amount}ml">×</button>
        </div>`;
      }).join("")
    : `<p class="log-empty">Nothing wogged this day 🎀</p>`;

  $("dayList").querySelectorAll(".log-del").forEach(b =>
    b.addEventListener("click", () => removeEntry(Number(b.dataset.idx))));

  $("dayAddRow").innerHTML = state.drinkSizes
    .map(a => `<button class="quick-btn" data-add="${a}">+${a}</button>`).join("");
  $("dayAddRow").querySelectorAll(".quick-btn").forEach(b =>
    b.addEventListener("click", () => addDrinkAt(ts, Number(b.dataset.add))));
}

// Past entries land at midday. The exact time has no effect on goals, streaks or
// unlocks — only the day's total does — so asking her for one would be friction
// with nothing behind it.
function addDrinkAt(dayTs, amount) {
  const d = new Date(dayTs);
  d.setHours(12, 0, 0, 0);
  let ts = d.getTime();
  while (state.log.some(e => e.ts === ts)) ts++;   // keep timestamps distinct
  state.log.push({ ts, amount, type: state.drinkType || "water" });
  state.log.sort((a, b) => a.ts - b.ts);
  if (state.log.length > 5000) state.log = state.log.slice(-5000);
  saveState();
  playPop();
  render();
  renderDaySheet();
  if (NATIVE) scheduleNative();
}

function initDaySheet() {
  $("dayClose").addEventListener("click", closeDay);
  $("daySheet").addEventListener("click", e => { if (e.target.id === "daySheet") closeDay(); });
}

/* --------------------------------------------------------------- intro */
// Without this the wardrobe and Mochi's moods are invisible — she would use it
// as a plain counter and never scroll far enough to find the fun half.
const INTRO = [
  { mood: "happy", t: "Tap to dwink! 🥤", b: "Tap a cup evewy time you dwink something. Howd a cup if you want a custom amount." },
  { mood: "sad", t: "Keep Mochi happy 🥺", b: "If you don't dwink fow a whiwe, Mochi gets sad and thirsty. Dwinking cheews hew wight up!" },
  { mood: "party", t: "Eawn pwetty things ✨", b: "Hit youw goaw to buiwd a stweak and unwock bows, hats and scenes fow Mochi to weaw." },
  { mood: "happy", t: "Mochi wiww wemind you 💧", b: "Tuwn on wemindews and Mochi wiww nudge you thwough the day — you can even dwink stwaight fwom the notification!" },
];
let introIdx = 0;

function paintIntro() {
  const s = INTRO[introIdx];
  $("introMascot").innerHTML = mochiSVG(s.mood);
  $("introMascot").className = "mascot-slot big" + (s.mood === "sad" ? " sad" : s.mood === "party" ? " party" : "");
  $("introTitle").textContent = s.t;
  $("introBody").textContent = s.b;
  $("introDots").innerHTML = INTRO.map((_, i) => `<span class="${i === introIdx ? "on" : ""}"></span>`).join("");
  $("introNext").textContent = introIdx === INTRO.length - 1 ? "Wet's dwink! 🎀" : "Next";
}

function showIntro() {
  introIdx = 0;
  paintIntro();
  $("intro").classList.remove("hidden");
}

function initIntro() {
  $("introNext").addEventListener("click", () => {
    if (introIdx < INTRO.length - 1) { introIdx++; paintIntro(); return; }
    state.seenIntro = true;
    saveState();
    $("intro").classList.add("hidden");
    render();
  });
}

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.add("hidden"), 2400);
}

function showUnlock(item) {
  const t = $("unlockToast");
  t.textContent = "New unwock! " + item.chip + " " + item.name;
  t.classList.remove("hidden");
  buzz([30, 50, 30]);
  clearTimeout(showUnlock._h);
  showUnlock._h = setTimeout(() => t.classList.add("hidden"), 3200);
}

/* --------------------------------------------------------- onboarding */
function initOnboarding() {
  $("onboardMascot").innerHTML = mochiSVG("happy");
  const go = () => {
    state.name = $("onboardName").value.trim() || "cutie";
    state.onboarded = true;
    saveState();
    $("onboard").classList.add("hidden");
    $("app").classList.remove("hidden");
    render();
    showIntro();
  };
  $("onboardGo").addEventListener("click", go);
  $("onboardName").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
}

/* ------------------------------------------------------------ settings */
// "auto" leaves the attribute off entirely so the prefers-color-scheme media
// query keeps control; light/dark stamp it and override the system either way.
function applyTheme() {
  const t = state.theme || "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

function renderThemeRow() {
  const row = $("themeRow");
  if (!row) return;
  row.querySelectorAll(".theme-btn").forEach(b =>
    b.classList.toggle("on", (state.theme || "auto") === b.dataset.theme));
}

function initTheme() {
  const row = $("themeRow");
  if (!row) return;
  row.querySelectorAll(".theme-btn").forEach(b => b.addEventListener("click", () => {
    state.theme = b.dataset.theme;
    saveState();
    applyTheme();          // applied straight away so the choice is visible behind the sheet
    renderThemeRow();
    buzz(12);
  }));
}

function initSettings() {
  $("settingsBtn").addEventListener("click", () => {
    $("setName").value = state.name || "";
    $("setGoal").value = state.goalMl;
    $("setStart").value = state.activeStart;
    $("setEnd").value = state.activeEnd;
    $("setSizes").value = state.drinkSizes.join(", ");
    $("setSound").checked = !!state.sound;
    renderThemeRow();
    $("settings").classList.remove("hidden");
  });
  $("setCancel").addEventListener("click", () => $("settings").classList.add("hidden"));
  $("setExport").addEventListener("click", exportBackup);
  $("setImport").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", e => {
    if (e.target.files && e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = "";                      // let the same file be picked twice
  });
  $("setSave").addEventListener("click", () => {
    state.name = $("setName").value.trim() || state.name;
    // Via setGoal so the change is recorded from today rather than rewriting
    // every day she has already finished.
    setGoal(Math.max(500, Number($("setGoal").value) || state.goalMl));
    state.activeStart = Math.min(23, Math.max(0, Number($("setStart").value) || 0));
    state.activeEnd = Math.min(23, Math.max(0, Number($("setEnd").value) || 22));
    const sizes = $("setSizes").value.split(",").map(s => Number(s.trim())).filter(n => n > 0 && n < 3000);
    if (sizes.length) state.drinkSizes = sizes.slice(0, 4);
    state.sound = $("setSound").checked;
    saveState();
    $("settings").classList.add("hidden");
    render({ rebuildBottle: true });
    if (NATIVE) scheduleNative();          // active hours / goal may have moved
  });
  $("celebrateClose").addEventListener("click", () => $("celebrate").classList.add("hidden"));
}

/* ------------------------------------------------- native notifications */
// In the Android build we hand the reminders to the OS alarm scheduler, which
// fires at a real time whether or not the app is running. The browser build
// can only poll while open — Chrome's periodic sync is best-effort and may
// never run — so the two paths are deliberately kept separate.
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
let nativeGranted = false;

function LN() {
  const C = window.Capacitor;
  return C && C.Plugins && C.Plugins.LocalNotifications;
}

function BAT() {
  const C = window.Capacitor;
  return C && C.Plugins && C.Plugins.Battery;
}

// Exact alarms are still killable: MIUI, One UI and EMUI put backgrounded apps
// into deep sleep and drop pending alarms. Ask once, and only after reminders
// are actually on, so the prompt has visible purpose.
async function refreshBatteryCard() {
  const card = $("batteryCard");
  if (!card) return;
  const bat = BAT();
  if (!NATIVE || !bat || !nativeGranted) { card.classList.add("hidden"); return; }
  try {
    const res = await bat.isIgnoringOptimizations();
    card.classList.toggle("hidden", !!(res && res.ignoring));
  } catch (e) {
    card.classList.add("hidden");
  }
}

function initBattery() {
  const btn = $("batteryBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const bat = BAT();
    if (!bat) return;
    try {
      await bat.requestIgnoreOptimizations();
      // The system dialog resolves before the user answers, so re-check on the
      // way back in rather than trusting the immediate result.
      setTimeout(refreshBatteryCard, 800);
    } catch (e) {}
  });
}

function notifSettled() {
  if (NATIVE) return nativeGranted;
  return !("Notification" in window) || Notification.permission === "granted";
}

// An overnight window (start > end, e.g. 22:00–06:00 on a night shift) wraps
// past midnight, so "inside the window" is not a single numeric range.
function inActiveWindow(h) {
  const s = state.activeStart, e = state.activeEnd;
  if (s === e) return true;                       // degenerate setting: treat as all day
  return s < e ? (h >= s && h < e) : (h >= s || h < e);
}

// Push a moment into her waking window. Advancing an hour at a time handles the
// wrapping case correctly; comparing against start/end directly used to collapse
// an overnight window down to a single reminder per day.
function clampToActive(d) {
  for (let i = 0; i < 48 && !inActiveWindow(d.getHours()); i++) {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  return d;
}

// Queue a rolling week of alarms rather than the next few. Android only fires
// what has been scheduled, and nothing reschedules unless she opens the app or
// taps a notification — with a short queue the app goes permanently silent
// after the last one, which is exactly the failure this is meant to prevent.
const QUEUE_DAYS = 7;
const MAX_QUEUED = 64;      // ~9/day over a 14h window; well inside Android's budget

// Each slot is measured from the previous *clamped* one, so a nudge pushed past
// her active window doesn't drag the following ones on top of it — a narrow
// window used to stack them all on one morning.
function reminderSlots() {
  const out = [];
  const horizon = Date.now() + QUEUE_DAYS * 86400000;
  let t;

  if (state.nextNudgeAt && state.nextNudgeAt > Date.now()) {
    // Snoozed: honour the requested moment, then resume the normal rhythm.
    const d = clampToActive(new Date(state.nextNudgeAt));
    out.push(d);
    t = d.getTime();
  } else if (todayTotal() >= state.goalMl) {
    // Goal already met: stay quiet until tomorrow morning.
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(state.activeStart, 0, 0, 0);
    out.push(d);
    t = d.getTime();
  } else {
    t = Math.max(lastLogTs() || 0, Date.now());
  }

  while (out.length < MAX_QUEUED) {
    const d = clampToActive(new Date(t + REMINDER_GAP_MS));
    if (d.getTime() > horizon) break;
    out.push(d);
    t = d.getTime();
  }
  return out;
}

// Escalation restarts each morning: waking up to "MOCHI IS DYING OF THIRST"
// on day five of a pre-built queue would be absurd.
function slotBodies(slots) {
  let day = null, idx = 0;
  return slots.map(d => {
    const k = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
    if (k !== day) { day = k; idx = 0; } else idx++;
    return line(NUDGES[Math.min(2, idx)]);
  });
}

// Clear by asking the OS what is actually pending, so ids left over from an
// older build or a longer queue are never orphaned.
async function cancelPendingNative(ln) {
  try {
    const pending = await ln.getPending();
    const list = pending && pending.notifications;
    if (list && list.length) await ln.cancel({ notifications: list.map(n => ({ id: n.id })) });
  } catch (e) {}
}

async function scheduleNative() {
  const ln = LN();
  if (!ln || !nativeGranted) return;
  try {
    await cancelPendingNative(ln);
    const slots = reminderSlots();
    const bodies = slotBodies(slots);
    await ln.schedule({
      notifications: slots.map((at, i) => ({
        id: 1000 + i,
        title: "Mochi says 🎀",
        body: bodies[i],
        actionTypeId: "SIP_REMIND",
        schedule: { at, allowWhileIdle: true },
        smallIcon: "ic_stat_sip",
      })),
    });
  } catch (e) { /* scheduling is best-effort; the app still works without it */ }
}

async function snoozeNative(mins) {
  // Rebuild the whole queue off the snoozed moment — scheduling a single
  // notification would leave nothing queued behind it.
  state.nextNudgeAt = Date.now() + mins * 60000;
  saveState();
  await scheduleNative();
  showToast("Okay! Mochi wiww wait " + mins + " min 🎀");
}

async function initNative() {
  const ln = LN();
  if (!ln) return;
  try {
    const perm = await ln.checkPermissions();
    nativeGranted = perm.display === "granted";

    await ln.registerActionTypes({
      types: [{
        id: "SIP_REMIND",
        actions: [
          { id: "sip250", title: "+250ml" },
          { id: "sip500", title: "+500ml" },
          { id: "snooze", title: "Snooze 20m" },
        ],
      }],
    });

    ln.addListener("localNotificationActionPerformed", ev => {
      const a = ev && ev.actionId;
      if (a === "sip250") logDrink(250);
      else if (a === "sip500") logDrink(500);
      else if (a === "snooze") snoozeNative(20);
      else render();
    });

    if (nativeGranted) scheduleNative();
    refreshBatteryCard();
  } catch (e) {}
}

/* ------------------------------------------------------- notifications */
function initNotifications() {
  $("notifBtn").addEventListener("click", async () => {
    if (NATIVE) {
      const ln = LN();
      if (!ln) { showToast("Wemindews awen't avaiwabwe hewe."); return; }
      const res = await ln.requestPermissions();
      nativeGranted = res.display === "granted";
      if (nativeGranted) {
        showToast("Yay! Mochi wiww wemind you 🎀");
        $("notifCard").classList.add("hidden");
        scheduleNative();
        refreshBatteryCard();
      } else {
        showToast("Mochi needs notification pewmission 🥺");
      }
      return;
    }
    if (!("Notification" in window)) { showToast("Notifications awen't suppowted hewe."); return; }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      showToast("Yay! Mochi wiww wemind you 🎀");
      $("notifCard").classList.add("hidden");
      tryPeriodicSync();
    }
  });

  if (NATIVE) initNative();
  else setInterval(checkReminder, 60 * 1000);

  setInterval(() => render({ keepLine: true }), 5 * 60 * 1000);  // mood decays over time
  if (!NATIVE) checkReminder();
}

function checkReminder() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!inActiveWindow(new Date().getHours())) return;
  if (todayTotal() >= state.goalMl) return;
  const sinceLog = Date.now() - (lastLogTs() || 0);
  const sinceNotify = Date.now() - (state.lastNotified || 0);
  if (sinceLog < REMINDER_GAP_MS || sinceNotify < REMINDER_GAP_MS) return;

  const tier = Math.min(2, Math.floor(sinceLog / REMINDER_GAP_MS) - 1);
  state.lastNotified = Date.now();
  saveState();
  const body = line(NUDGES[Math.max(0, tier)]);
  const opts = { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "sip-reminder", renotify: true };
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(r => r.showNotification("Mochi says 🎀", opts)).catch(() => {});
  } else {
    try { new Notification("Mochi says 🎀", opts); } catch (e) {}
  }
}

async function tryPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ("periodicSync" in reg) {
      const st = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (st.state === "granted") await reg.periodicSync.register("hydration-check", { minInterval: 60 * 60 * 1000 });
    }
  } catch (e) { /* unsupported on iOS; foreground checks still run */ }
}

function syncStateToSW() {
  // `"caches" in window` is not enough: the property can exist but be unusable
  // (insecure origins, embedded webviews), and saveState must never throw.
  if (typeof caches === "undefined" || !caches || !caches.open) return;
  const snap = {
    goalMl: state.goalMl, activeStart: state.activeStart, activeEnd: state.activeEnd,
    lastLogTs: lastLogTs(), todayTotal: todayTotal(), name: state.name || "cutie",
  };
  caches.open("sip-state").then(c => c.put("/state.json", new Response(JSON.stringify(snap)))).catch(() => {});
}

/* ---------------------------------------------------------------- boot */
function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  // Ask the browser not to evict us under storage pressure — everything she has
  // ever logged lives in localStorage and there is no server-side copy.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  ensureGoalHistory();
  applyTheme();
  initOnboarding();
  initSettings();
  initTheme();
  initDaySheet();
  $("undoBtn").addEventListener("click", undoRemove);
  initNotifications();
  initCustom();
  initBattery();
  initPet();
  initCalendar();
  initIntro();
  if (state.onboarded) {
    $("app").classList.remove("hidden");
    render();
    if (!state.seenIntro) showIntro();      // existing users get it once too
  } else {
    $("onboard").classList.remove("hidden");
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.onboarded) return;
    render({ keepLine: true });
    refreshBatteryCard();      // she may have just granted it in system settings
  });
  syncStateToSW();
}

document.addEventListener("DOMContentLoaded", boot);
