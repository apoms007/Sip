// Drives the real app.js in a Node vm to check the reminder scheduler.
// Top-level `function` declarations land on the vm's global object, so the
// scheduling helpers can be called directly without exporting anything.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const GAP = 90 * 60 * 1000;

function load(stateObj) {
  const store = { sip_state_v2: JSON.stringify(stateObj) };
  const ctx = {
    console,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
    navigator: {},
    caches: undefined,
    setInterval: () => {},
    setTimeout: () => {},
    requestAnimationFrame: () => {},
    document: { addEventListener: () => {}, getElementById: () => null },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

function baseState(over) {
  return Object.assign({
    name: "Tester", goalMl: 2000, activeStart: 8, activeEnd: 22,
    drinkSizes: [150, 250, 350, 500], log: [], lastNotified: 0, bestStreak: 0,
    unlocked: ["bow_red", "hat_none", "bg_plain"],
    equipped: { bow: "bow_red", hat: "hat_none", bg: "bg_plain" },
    sound: true, onboarded: true, celebratedOn: null,
  }, over);
}

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("  ok   " + label); return; }
  failures++;
  console.log("  FAIL " + label + (detail ? "  -> " + detail : ""));
}

function fmt(d) {
  return d.toISOString().slice(0, 16).replace("T", " ") + " (h=" + d.getHours() + ")";
}

function scenario(name, stateObj) {
  console.log("\n" + name);
  const ctx = load(stateObj);
  const slots = ctx.reminderSlots();
  const now = Date.now();
  const s = stateObj;
  const span = (slots[slots.length - 1].getTime() - now) / 86400000;

  console.log("  " + slots.length + " slots over " + span.toFixed(1) + "d: " +
    fmt(slots[0]) + " ... " + fmt(slots[slots.length - 1]));

  check("all in the future", slots.every(d => d.getTime() > now));
  check("strictly increasing",
    slots.every((d, i) => i === 0 || d.getTime() > slots[i - 1].getTime()));
  check("all inside active hours",
    slots.every(d => d.getHours() >= s.activeStart && d.getHours() < s.activeEnd),
    slots.map(d => d.getHours()).join(","));
  check("spaced >= gap apart",
    slots.every((d, i) => i === 0 || d.getTime() - slots[i - 1].getTime() >= GAP));
  // The whole point of the rolling queue: ignoring the app for days must not
  // silence it, and the queue must not exceed Android's alarm budget.
  check("queue reaches >= 5 days out", span >= 5, span.toFixed(1) + "d");
  check("queue capped at 64", slots.length <= 64, "got " + slots.length);

  // Bodies must escalate within a day and reset the next morning.
  const bodies = ctx.slotBodies(slots);
  check("one body per slot", bodies.length === slots.length);
  check("no body is empty", bodies.every(b => typeof b === "string" && b.length > 0));
  return { slots, ctx };
}

const now = Date.now();
const HOUR = 3600000;

// A drink a few minutes ago — the ordinary case.
scenario("just drank", baseState({ log: [{ ts: now - 5 * 60000, amount: 250 }] }));

// Nothing logged for hours: nudges should restart from now, not the stale log.
scenario("stale log (9h ago)", baseState({ log: [{ ts: now - 9 * HOUR, amount: 250 }] }));

// Brand new install, nothing logged at all.
scenario("empty log", baseState({}));

// Goal already met: first nudge must be tomorrow morning.
const met = scenario("goal met", baseState({
  log: [{ ts: now - 30 * 60000, amount: 2000 }],
})).slots;
check("goal-met first slot is >= 8h out", met[0].getTime() - now > 8 * HOUR,
  ((met[0].getTime() - now) / HOUR).toFixed(1) + "h");

// Narrow window forces every slot through the next-morning rollover, which is
// where colliding timestamps used to appear.
scenario("narrow window 8-10", baseState({
  activeStart: 8, activeEnd: 10,
  log: [{ ts: now - 5 * 60000, amount: 250 }],
}));

// Overnight-ish window with a late start.
scenario("late window 20-23", baseState({
  activeStart: 20, activeEnd: 23,
  log: [{ ts: now - 5 * 60000, amount: 250 }],
}));

// Snoozing must honour the requested moment AND keep the week queued behind it,
// otherwise a single snooze tap would drain the whole schedule.
console.log("\nsnooze respected");
{
  const snoozeAt = now + 20 * 60000;
  const ctx = load(baseState({
    nextNudgeAt: snoozeAt,
    log: [{ ts: now - 5 * 60000, amount: 250 }],
  }));
  const slots = ctx.reminderSlots();
  const firstDelta = (slots[0].getTime() - now) / 60000;
  const span = (slots[slots.length - 1].getTime() - now) / 86400000;
  console.log("  first slot in " + firstDelta.toFixed(0) + " min, " +
    slots.length + " slots over " + span.toFixed(1) + "d");
  // Test the RAW snooze moment, not the clamped slot: if now+20min lands
  // outside active hours the nudge is legitimately pushed to the morning, and
  // asserting against the clamped hour makes this pass or fail purely by
  // what time of day the suite happens to run.
  const raw = new Date(snoozeAt);
  const inHours = raw.getHours() >= 8 && raw.getHours() < 22;
  check("snooze honoured (or clamped into hours)",
    inHours ? Math.abs(firstDelta - 20) < 2 : firstDelta > 20,
    firstDelta.toFixed(0) + " min");
  check("queue survives the snooze", slots.length > 20, "got " + slots.length);
}

// A drink must outrank a stale snooze rather than leaving a hole in the queue.
console.log("\nexpired snooze ignored");
{
  const ctx = load(baseState({
    nextNudgeAt: now - 60 * 60000,
    log: [{ ts: now - 5 * 60000, amount: 250 }],
  }));
  const slots = ctx.reminderSlots();
  check("past nextNudgeAt not used", slots[0].getTime() > now);
  check("queue still full", slots.length > 20, "got " + slots.length);
}

console.log("\n" + (failures ? failures + " FAILURE(S)" : "all checks passed"));
process.exit(failures ? 1 : 0);
