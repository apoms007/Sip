// Verifies removing a mis-tapped drink against the real removeEntry in app.js.
// Removal touches today's total, the streak, and the once-per-day celebration
// latch, so it is easy to leave the app in a state where a genuine goal never
// celebrates again.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function load(log, extra) {
  const st = Object.assign({
    name: "T", goalMl: 2000, activeStart: 8, activeEnd: 22,
    drinkSizes: [150, 250, 350, 500], log, lastNotified: 0, bestStreak: 0,
    unlocked: ["bow_red", "hat_none", "bg_plain"],
    equipped: { bow: "bow_red", hat: "hat_none", bg: "bg_plain" },
    sound: true, onboarded: true, celebratedOn: null, nextNudgeAt: 0,
    drinkType: "water", seenIntro: true,
  }, extra || {});

  const store = { sip_state_v2: JSON.stringify(st) };
  const els = {};
  const stubEl = () => ({
    innerHTML: "", textContent: "", value: "", disabled: false, className: "",
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; },
    appendChild() {}, remove() {}, firstChild: null, offsetWidth: 0,
    setAttribute() {}, getAttribute() { return null; },
  });
  const ctx = {
    console,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    navigator: {}, caches: undefined,
    setInterval: () => {}, setTimeout: () => {}, clearTimeout: () => {},
    requestAnimationFrame: () => {},
    document: {
      addEventListener: () => {},
      getElementById: id => (els[id] = els[id] || stubEl()),
      createElement: stubEl,
      body: stubEl(),
    },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, store };
}

let failures = 0;
function expect(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  (got " + got + ", want " + want + ")");
}

const noon = new Date(); noon.setHours(12, 0, 0, 0);
const at = m => noon.getTime() + m * 60000;

console.log("removing a mis-tapped drink");

// Removing the accidental entry restores the correct total.
{
  const { ctx } = load([
    { ts: at(0), amount: 250, type: "water" },
    { ts: at(5), amount: 500, type: "water" },   // the mis-tap
    { ts: at(9), amount: 250, type: "tea" },
  ]);
  expect("total before", ctx.todayTotal(), 1000);
  ctx.removeEntry(1);
  expect("total after removing index 1", ctx.todayTotal(), 500);
  expect("entries left", ctx.dayTotals().size, 1);
}

// Out-of-range indices must be inert, not throw or corrupt the log.
{
  const { ctx } = load([{ ts: at(0), amount: 250, type: "water" }]);
  ctx.removeEntry(-1);
  ctx.removeEntry(99);
  expect("bad indices leave log intact", ctx.todayTotal(), 250);
}

// The celebration latch must reopen when a removal drops her back under goal,
// otherwise reaching it for real later would pass silently.
{
  const { ctx, store } = load([
    { ts: at(0), amount: 1800, type: "water" },
  ], { celebratedOn: null });
  ctx.logDrink(300);                       // 1800 -> 2100, crosses and latches
  const latched = JSON.parse(store.sip_state_v2).celebratedOn;
  expect("latched after hitting goal", latched !== null, true);
  ctx.removeEntry(0);                      // drop the 1800 -> back under goal
  expect("under goal after removal", ctx.todayTotal() < 2000, true);
  expect("celebration latch cleared", JSON.parse(store.sip_state_v2).celebratedOn, null);
}

// Staying above goal after a removal should keep the latch, so she is not
// congratulated twice in one day.
{
  const { ctx, store } = load([], { celebratedOn: null });
  ctx.logDrink(2500);
  ctx.logDrink(300);
  const before = JSON.parse(store.sip_state_v2).celebratedOn;
  ctx.removeEntry(1);                      // still 2500, above goal
  expect("latch kept while still above goal",
    JSON.parse(store.sip_state_v2).celebratedOn, before);
}

// Yesterday's entries must survive untouched when today's are removed.
{
  const { ctx } = load([
    { ts: at(0) - 86400000, amount: 2000, type: "water" },
    { ts: at(0), amount: 250, type: "water" },
  ]);
  ctx.removeEntry(1);
  expect("today emptied", ctx.todayTotal(), 0);
  expect("yesterday untouched", ctx.lifetimeMl(), 2000);
}

// Removal must persist, not just mutate memory.
{
  const { ctx, store } = load([
    { ts: at(0), amount: 250, type: "water" },
    { ts: at(5), amount: 350, type: "coffee" },
  ]);
  ctx.removeEntry(0);
  expect("persisted to storage", JSON.parse(store.sip_state_v2).log.length, 1);
  expect("correct entry survived", JSON.parse(store.sip_state_v2).log[0].amount, 350);
}

console.log("\n" + (failures ? failures + " FAILURE(S)" : "all checks passed"));
process.exit(failures ? 1 : 0);
