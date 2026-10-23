import assert from "node:assert/strict";
import { flush, harness, key, local } from "./lib/calendar-harness.mjs";

function assertGrid(calendar, count) {
  const { from, to, dayCount } = calendar.viewRange;
  const cells = calendar.monthCells;
  assert.equal(dayCount, count);
  assert.equal(cells.length, count);
  assert.equal(from.getDay(), 1, "weeks start on Monday");
  assert.equal(from.getHours(), 0);
  assert.equal(to.getHours(), 0);
  assert.equal(cells[0].key, key(from));
  const end = new Date(from);
  for (const cell of cells) {
    assert.equal(cell.key, key(end), "grid uses consecutive local days");
    end.setDate(end.getDate() + 1);
  }
  assert.equal(end.getTime(), to.getTime(), "exclusive end matches grid");
  assert.ok(cells.some((cell) => cell.key === calendar.selectedDate));
}

function assertQueries(h, calendar) {
  const { from, to } = calendar.viewRange;
  const personal = h.calls.findLast(
    (call) => call.path === "/isbf/api/entries.json"
  );
  assert.equal(
    h.calls.some((call) => call.path.includes("events.json")),
    false
  );
  assert.equal(personal.data.from, new Date(+from - 86400000).toISOString());
  assert.equal(personal.data.to, new Date(+to + 86400000).toISOString());
}

// Use a DST timezone as well as the site's timezone: a calendar day is not
// always 24 hours, and ISO conversion must not shift the visible day keys.
for (const timezone of ["Asia/Shanghai", "America/New_York"]) {
  process.env.TZ = timezone;
  const h = await harness();
  for (const [month, anchor, expected] of [
    ["2026-02-01", 31, "2026-02-28"],
    ["2024-02-01", 31, "2024-02-29"],
    ["2026-03-01", 31, "2026-03-31"],
    ["2026-12-01", 1, "2026-12-01"],
  ]) {
    const date = h.calendarMonthAnchor(local(month), anchor);
    assert.equal(key(date), expected);
    assert.equal(date.getHours(), 12);
  }
  for (const [month, anchor] of [
    ["2026-01-01", 1],
    ["2026-12-01", 31],
    ["2024-02-01", 29],
    ["2026-03-01", 8],
    ["2026-11-01", 1],
  ]) {
    for (const compact of [true, false]) {
      const range = h.calendarWindow(local(month), compact, anchor);
      const expected = compact
        ? h.calendarMonthAnchor(local(month), anchor)
        : local(month);
      expected.setDate(expected.getDate() - ((expected.getDay() + 6) % 7));
      if (compact) {
        expected.setDate(expected.getDate() - 14);
      }
      expected.setHours(0, 0, 0, 0);
      assert.equal(range.from.getTime(), expected.getTime());
      expected.setDate(expected.getDate() + (compact ? 35 : 42));
      assert.equal(range.to.getTime(), expected.getTime());
      assert.equal(range.dayCount, compact ? 35 : 42);
    }
  }
}

for (const width of [390, 430, 600, 601, 768, 1024, 1440]) {
  const h = await harness(width);
  const calendar = new h.Calendar();
  await flush();
  assert.equal(calendar.isCompact, width <= 600);
  assertGrid(calendar, width <= 600 ? 35 : 42);
  assertQueries(h, calendar);
  if (width <= 600) {
    const index = calendar.monthCells.findIndex((cell) => cell.isToday);
    assert.equal(Math.floor(index / 7), 2, "today starts in the third row");
  }
  calendar.willDestroy();
  assert.equal(h.timers.size, 0);
  assert.equal(
    h.media.listenerCount + h.window.listenerCount + h.document.listenerCount,
    0
  );
}

for (const [date, hours] of [
  ["2026-03-08T00:00:00", 23],
  ["2026-11-01T00:00:00", 25],
]) {
  const dst = await harness(390, date);
  const calendar = new dst.Calendar();
  await flush();
  const { delay } = [...dst.timers.values()][0];
  assert.ok(
    delay >= hours * 3600000 && delay < hours * 3600000 + 1000,
    "midnight timer follows local midnight across DST"
  );
  calendar.willDestroy();
}

const h = await harness();
const calendar = new h.Calendar();
await flush();
calendar.nextMonth();
await flush();
assert.equal(calendar.selectedDate, "2026-02-28");
assert.equal(calendar.mobileAnchorDay, 31, "February keeps the preferred day");
calendar.nextMonth();
await flush();
assert.equal(calendar.selectedDate, "2026-03-31");
calendar.previousMonth();
await flush();
assert.equal(calendar.selectedDate, "2026-02-28");
assertGrid(calendar, 35);
assertQueries(h, calendar);
const start = calendar.viewRange.from.getTime();
const month = calendar.visibleMonth.getTime();
const spillover = calendar.monthCells.find((cell) => !cell.inMonth);
const count = h.calls.length;
calendar.selectDate(spillover.key);
await flush();
assert.equal(calendar.selectedDate, spillover.key);
assert.equal(calendar.visibleMonth.getTime(), month);
assert.equal(
  calendar.viewRange.from.getTime(),
  start,
  "taps keep the grid stationary"
);
assert.equal(
  h.calls.length,
  count,
  "already loaded spillover needs no request"
);
h.resize(1024);
await flush();
assertGrid(calendar, 42);
assertQueries(h, calendar);
h.resize(390);
await flush();
assertGrid(calendar, 35);
assertQueries(h, calendar);

calendar.goToday();
await flush();
h.setNow("2026-02-01T00:00:01");
assert.equal(h.timers.size, 1, "one midnight refresh is scheduled");
const timer = [...h.timers.values()][0];
assert.ok(timer.delay > 0 && timer.delay <= 86400000);
h.timers.clear();
timer.callback();
await flush();
assert.equal(calendar.todayKey, "2026-02-01");
assert.equal(calendar.selectedDate, "2026-02-01");
assert.equal(
  Math.floor(calendar.monthCells.findIndex((cell) => cell.isToday) / 7),
  2
);
calendar.nextMonth();
await flush();
const browsed = calendar.viewRange.from.getTime();
h.document.hidden = true;
h.document.visibilityState = "hidden";
h.document.emit("visibilitychange");
h.setNow("2026-02-02T08:00:00");
h.document.hidden = false;
h.document.visibilityState = "visible";
h.document.emit("visibilitychange");
h.window.emit("focus");
await flush();
assert.equal(calendar.todayKey, "2026-02-02");
assert.equal(
  calendar.viewRange.from.getTime(),
  browsed,
  "rollover preserves a browsed window"
);
assert.ok(!calendar.monthCells.some((cell) => cell.isToday));
calendar.goToday();
await flush();
assert.equal(calendar.selectedDate, "2026-02-02");
assertGrid(calendar, 35);
h.setNow("2026-02-09T08:00:00");
h.window.emit("focus");
await flush();
assert.equal(calendar.selectedDate, "2026-02-09");
assert.equal(
  Math.floor(calendar.monthCells.findIndex((cell) => cell.isToday) / 7),
  2,
  "focus catches up a following-today window after a sleeping tab"
);
assertQueries(h, calendar);

h.setHandler((path) => {
  if (path === "/isbf/api/entries/9.json") {
    return {
      entry: { id: 9, starts_at: "2027-12-31T00:00:00Z", all_day: true },
    };
  }
  return path.includes("events.json") ? { events: [] } : { entries: [] };
});
h.router.currentURL = "/calendar?entry_id=9";
await calendar.focusFromRoute();
await flush();
assert.equal(calendar.selectedDate, "2027-12-31");
assert.equal(calendar.mobileFocusDate, "2027-12-31");
assert.equal(calendar.focusedEntryId, 9);
assertGrid(calendar, 35);
assertQueries(h, calendar);
h.resize(1440);
await flush();
assertGrid(calendar, 42);
calendar.nextMonth();
await flush();
assert.equal(
  calendar.selectedDate,
  "2028-01-01",
  "desktop arrows select month start"
);

const deferred = [];
h.setHandler(
  (path) =>
    new Promise((resolve, reject) => deferred.push({ path, resolve, reject }))
);
const older = calendar.loadMonth();
calendar.nextMonth();
const current = deferred.splice(1);
for (const request of current) {
  request.resolve(
    request.path.includes("events.json")
      ? { events: [] }
      : { entries: [{ id: 22 }] }
  );
}
await flush();
for (const request of deferred.splice(0)) {
  request.resolve(
    request.path.includes("events.json")
      ? { events: [] }
      : { entries: [{ id: 11 }] }
  );
}
await older;
assert.equal(
  calendar.personalEntries[0].id,
  22,
  "late range responses cannot replace current data"
);
h.setHandler(async () => {
  throw new Error("offline");
});
await calendar.loadMonth();
assert.equal(calendar.loadError, true);
assert.equal(calendar.isLoading, false);
h.setHandler((path) =>
  path.includes("events.json") ? { events: [] } : { entries: [] }
);
await calendar.loadMonth();
assert.equal(calendar.loadError, false, "failed range can be retried");
h.setHandler(
  (path) => new Promise((resolve) => deferred.push({ path, resolve }))
);
const pending = calendar.loadMonth();
calendar.isDestroying = true;
calendar.willDestroy();
for (const request of deferred) {
  request.resolve(
    request.path.includes("events.json")
      ? { events: [] }
      : { entries: [{ id: 99 }] }
  );
}
await pending;
assert.equal(
  calendar.personalEntries.length,
  0,
  "disposal ignores pending range responses"
);
assert.equal(h.timers.size, 0);
assert.equal(
  h.media.listenerCount + h.window.listenerCount + h.document.listenerCount,
  0
);
process.stdout.write(
  "Calendar five-week windows, ranges, navigation, rollover and disposal OK\n"
);
