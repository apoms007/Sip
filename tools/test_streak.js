// Verifies the grace-day streak rules against the real computeStreak in app.js.
// Streaks are what keep her using it, so the forgiveness rule has to be exactly
// as generous as intended — no more, no less.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const DAY = 86400000;

function load(log, goalMl) {
  const st = {
    name: "T", goalMl: goalMl || 2000, activeStart: 8, activeEnd: 22,
    drinkSizes: [250], log, lastNotified: 0, bestStreak: 0,
    unlocked: [], equipped: { bow: "bow_red", hat: "hat_none", bg: "bg_plain" },
    sound: true, onboarded: true, celebratedOn: null, nextNudgeAt: 0,
    drinkType: "water", seenIntro: true,
  };
  const store = { sip_state_v2: JSON.stringify(st) };
  const ctx = {
    console,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    navigator: {}, caches: undefined,
    setInterval: () => {}, setTimeout: () => {}, requestAnimationFrame: () => {},
    document: { addEventListener: () => {}, getElementById: () => null },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

// `hit` lists days-ago that met the goal (0 = today).
function logFor(hit) {
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  return hit.map(d => ({ ts: noon.getTime() - d * DAY, amount: 2000, type: "water" }));
}

let failures = 0;
function expect(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  (got " + got + ", want " + want + ")");
}

function streakOf(hit, label, want, wantForgiven) {
  const ctx = load(logFor(hit));
  const r = ctx.computeStreak(ctx.dayTotals());
  expect(label, r.streak, want);
  if (wantForgiven !== undefined) expect(label + " [forgiven]", r.forgiven, wantForgiven);
}

console.log("grace-day streak rules");

// No gaps at all.
streakOf([0, 1, 2, 3, 4], "5 clean days", 5, false);

// Today not yet done must not break a run that is otherwise intact.
streakOf([1, 2, 3], "today pending, 3 behind", 3, false);

// A single miss inside the week is forgiven; the streak spans the hole but the
// missed day itself is not counted.
streakOf([0, 1, 2, 4, 5, 6], "one gap at day 3", 6, true);

// Two misses close together: the second has no grace left, so it stops there.
streakOf([0, 1, 3, 5, 6, 7], "two gaps within a week", 3, true);

// Grace recharges after 7 days, so two gaps far apart both survive.
streakOf([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14], "gaps 9 days apart", 13, true);

// Nothing logged at all.
streakOf([], "empty history", 0, false);

// A long clean run should not silently consume grace.
streakOf(Array.from({ length: 20 }, (_, i) => i), "20 clean days", 20, false);

// Days below goal don't count as hits.
{
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  const ctx = load([
    { ts: noon.getTime(), amount: 500, type: "water" },
    { ts: noon.getTime() - DAY, amount: 2000, type: "water" },
    { ts: noon.getTime() - 2 * DAY, amount: 2000, type: "water" },
  ]);
  const r = ctx.computeStreak(ctx.dayTotals());
  expect("partial day today doesn't break run", r.streak, 2);
}

// Multiple small drinks must add up to the goal.
{
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  const ctx = load([
    { ts: noon.getTime(), amount: 1000, type: "water" },
    { ts: noon.getTime() + 60000, amount: 600, type: "tea" },
    { ts: noon.getTime() + 120000, amount: 400, type: "coffee" },
  ]);
  const r = ctx.computeStreak(ctx.dayTotals());
  expect("mixed drink types sum to goal", r.streak, 1);
}

console.log("\n" + (failures ? failures + " FAILURE(S)" : "all checks passed"));
process.exit(failures ? 1 : 0);
