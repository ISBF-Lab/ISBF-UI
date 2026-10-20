import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const key = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const local = (value) => new Date(`${value}T12:00:00`);
const flush = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, callback) {
      if (!listeners.has(name)) {
        listeners.set(name, new Set());
      }
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback);
    },
    emit(name, event = {}) {
      for (const callback of listeners.get(name) || []) {
        callback(event);
      }
    },
    get listenerCount() {
      return [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
    },
  };
}

async function harness(width = 390, date = "2026-01-31T12:00:00") {
  let now = new Date(date).getTime();
  class ClockDate extends Date {
    static now() {
      return now;
    }

    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
  }
  const timers = new Map();
  let timerId = 0;
  const setTimeout = (callback, delay) => {
    timers.set(++timerId, { callback, delay });
    return timerId;
  };
  const clearTimeout = (id) => timers.delete(id);
  const media = { ...eventTarget(), matches: width <= 600 };
  const window = {
    ...eventTarget(),
    setTimeout,
    clearTimeout,
    matchMedia(query) {
      assert.equal(query, "(max-width: 600px)");
      return media;
    },
  };
  const document = {
    ...eventTarget(),
    visibilityState: "visible",
    hidden: false,
    querySelector: () => null,
  };
  const appEvents = {
    on() {},
    off() {},
    trigger() {},
  };
  const router = { on() {}, off() {}, currentURL: "/calendar" };
  class Component {
    constructor() {
      this.args = {};
      this.currentUser = { id: 7 };
      this.appEvents = appEvents;
      this.router = router;
      this.modal = { show() {} };
      // Ember's @action binds callbacks before browser listeners receive them.
      for (const [name, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(Object.getPrototypeOf(this))
      )) {
        if (name !== "constructor" && typeof descriptor.value === "function") {
          this[name] = descriptor.value.bind(this);
        }
      }
    }

    willDestroy() {}
  }
  const calls = [];
  let handler = (path) =>
    path.includes("events.json") ? { events: [] } : { entries: [] };
  const context = vm.createContext({
    Date: ClockDate,
    URLSearchParams,
    window,
    document,
    setTimeout,
    clearTimeout,
  });
  const synthetic = (values) =>
    new vm.SyntheticModule(
      Object.keys(values),
      function () {
        for (const [name, value] of Object.entries(values)) {
          this.setExport(name, value);
        }
      },
      { context }
    );
  const helper = new vm.SourceTextModule(
    read("javascripts/discourse/lib/calendar-window.js"),
    { context }
  );
  await helper.link(() => {});
  await helper.evaluate();
  const dependencies = {
    "@glimmer/component": { default: Component },
    "@glimmer/tracking": { tracked: null },
    "@ember/helper": { fn: null },
    "@ember/modifier": { on: null },
    "@ember/object": { action: null },
    "@ember/runloop": { scheduleOnce() {} },
    "@ember/service": { service: null },
    "virtual:theme": {
      settings: {
        calendar_category_id: 4,
        calendar_category_path: "/c/events/4",
      },
      themePrefix: (value) => value,
    },
    "discourse/lib/ajax": {
      ajax: async (path, options = {}) => {
        calls.push({ path, ...options });
        return handler(path, options);
      },
    },
    "discourse/truth-helpers": { eq: null },
    "discourse/ui-kit/d-button": { default: null },
    "discourse/ui-kit/helpers/d-icon": { default: null },
    "discourse-i18n": {
      default: { currentLocale: () => "en" },
      i18n: (value) => value,
    },
    "./isbf-calendar-note-editor": { default: null },
    "./isbf-calendar-entry-editor": { default: null },
    "./isbf-calendar-subscribe": { default: null },
    "./isbf-calendar-update-dialog": { default: null },
  };
  const official = new vm.SourceTextModule(
    read("javascripts/discourse/lib/official-calendar.js"),
    { context }
  );
  await official.link((name) => {
    if (name === "./optional-topic-title") {
      return synthetic({ optionalTopicTitle: (value) => value });
    }
    assert.ok(dependencies[name], `Unstubbed official dependency: ${name}`);
    return synthetic(dependencies[name]);
  });
  await official.evaluate();
  const module = new vm.SourceTextModule(
    read("javascripts/discourse/components/isbf-v2-calendar.gjs")
      .replace(/<template>[\s\S]*<\/template>/, "")
      .replace(/^\s*@service\s+\w+;\s*$/gm, "")
      .replace(/@(tracked|action)\s+/g, ""),
    { context }
  );
  await module.link((name) => {
    if (name === "../lib/calendar-window") {
      return helper;
    }
    if (name === "../lib/official-calendar") {
      return official;
    }
    assert.ok(dependencies[name], `Unstubbed dependency: ${name}`);
    return synthetic(dependencies[name]);
  });
  await module.evaluate();
  return {
    Calendar: module.namespace.default,
    ...helper.namespace,
    calls,
    timers,
    window,
    document,
    media,
    router,
    setHandler(value) {
      handler = value;
    },
    setNow(value) {
      now = new Date(value).getTime();
    },
    resize(value) {
      media.matches = value <= 600;
      media.emit("change", { matches: media.matches });
    },
  };
}

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
  const { from, to } = calendar.fetchRange;
  const personal = h.calls.findLast(
    (call) => call.path === "/isbf/api/entries.json"
  );
  const community = h.calls.findLast((call) =>
    call.path.includes("events.json")
  );
  assert.equal(community.data.after, from.toISOString());
  assert.equal(community.data.before, to.toISOString());
  assert.equal(personal.data.from, new Date(+from - 86400000).toISOString());
  assert.equal(personal.data.to, new Date(+to + 86400000).toISOString());
}

// Use local calendar arithmetic in both the site timezone and a DST timezone.
for (const timezone of ["Asia/Shanghai", "America/New_York"]) {
  process.env.TZ = timezone;
  const h = await harness();
  for (const [month, day, expected] of [
    ["2026-02-01", 31, "2026-02-28"],
    ["2024-02-01", 31, "2024-02-29"],
    ["2026-03-01", 31, "2026-03-31"],
  ]) {
    const date = h.calendarMonthAnchor(local(month), day);
    assert.equal(key(date), expected);
    assert.equal(date.getHours(), 12);
  }
  for (const [month, from, count] of [
    ["2026-10-01", "2026-09-28", 35],
    ["2026-11-01", "2026-10-26", 42],
    ["2027-02-01", "2027-02-01", 35],
    ["2026-03-01", "2026-02-23", 42],
    ["2026-12-01", "2026-11-30", 35],
  ]) {
    for (const [compact, expanded, days] of [
      [true, false, count],
      [true, true, 42],
      [false, false, 42],
    ]) {
      const range = h.calendarWindow(local(month), compact, expanded);
      assert.equal(key(range.from), from);
      assert.equal(range.from.getHours(), 0);
      assert.equal(range.to.getHours(), 0);
      assert.equal(range.dayCount, days);
      const end = new Date(range.from);
      for (let day = 0; day < days; day++) {
        end.setDate(end.getDate() + 1);
      }
      assert.equal(
        +range.to,
        +end,
        "exclusive end follows local days across DST/year"
      );
    }
  }
}
process.env.TZ = "Asia/Shanghai";

const empty = (path) =>
  path.includes("events.json") ? { events: [] } : { entries: [] };
const entry = (id, starts_at, ends_at, extra = {}) => ({
  id,
  starts_at,
  ends_at,
  ...extra,
});
const event = (id, starts_at, ends_at, extra = {}) => ({
  id,
  name: `Event ${id}`,
  occurrences: [{ starts_at, ends_at }],
  ...extra,
});
const sixth = entry(
  1,
  "2026-11-02T09:00:00+08:00",
  "2026-11-02T10:00:00+08:00"
);
const fifth = entry(
  2,
  "2026-10-31T09:00:00+08:00",
  "2026-10-31T10:00:00+08:00"
);
const sixthEvent = event(3, sixth.starts_at, sixth.ends_at);
const isCommunity = (path) => path.includes("events.json");

for (const width of [390, 430, 600, 601, 768, 1024, 1440, 1920]) {
  const h = await harness(width, "2026-10-20T12:00:00");
  const calendar = new h.Calendar();
  await flush();
  assert.equal(calendar.isCompact, width <= 600);
  assertGrid(calendar, width <= 600 ? 35 : 42);
  assert.equal(key(calendar.viewRange.from), "2026-09-28");
  assert.equal(key(calendar.fetchRange.to), "2026-11-09");
  assertQueries(h, calendar);
  const requests = h.calls.length;
  h.resize(width <= 600 ? 1024 : 390);
  await flush();
  assert.equal(
    h.calls.length,
    requests,
    "resize reuses the same six-week query"
  );
  calendar.willDestroy();
  assert.equal(h.timers.size, 0);
  assert.equal(
    h.media.listenerCount + h.window.listenerCount + h.document.listenerCount,
    0
  );
}

// Decisions use all fetched sources, independently of the active agenda filter.
for (const [personal, community, count, description] of [
  [[fifth], [], 35, "first five weeks"],
  [[sixth], [], 42, "personal sixth week"],
  [[], [sixthEvent], 42, "community sixth week"],
  [
    [
      entry(4, "2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z", {
        all_day: true,
      }),
    ],
    [],
    42,
    "all-day",
  ],
  [
    [entry(5, "2026-11-01T23:30:00+08:00", "2026-11-02T00:30:00+08:00")],
    [],
    42,
    "cross-week",
  ],
  [
    [entry(6, "2026-11-01T23:00:00+08:00", "2026-11-02T00:00:00+08:00")],
    [],
    35,
    "exclusive boundary",
  ],
  [
    [
      entry(7, "2026-11-02T00:00:00+08:00", "2026-11-02T00:00:00+08:00", {
        source_item_id: 10,
      }),
    ],
    [],
    42,
    "official deadline",
  ],
]) {
  const h = await harness(390, "2026-10-20T12:00:00");
  const calendar = new h.Calendar();
  await flush();
  calendar.setFilter("community");
  h.setHandler((path) =>
    isCommunity(path) ? { events: community } : { entries: personal }
  );
  await calendar.loadMonth();
  assertGrid(calendar, count);
  assert.equal(calendar.viewRange.dayCount, count, description);
  const calls = h.calls.length;
  calendar.setFilter("personal");
  calendar.setFilter("all");
  assert.equal(
    calendar.viewRange.dayCount,
    count,
    "filter does not change the grid"
  );
  assert.equal(h.calls.length, calls);
  h.setHandler(empty);
  await calendar.loadMonth();
  assertGrid(calendar, 35); // Deleting the final sixth-week occurrence collapses.
  calendar.willDestroy();
}

// A failed source cannot prove an empty sixth week; successful data can expand it.
for (const failing of ["personal", "community"]) {
  const h = await harness(390, "2026-10-20T12:00:00");
  const calendar = new h.Calendar();
  await flush();
  h.setHandler((path) => {
    if (isCommunity(path) === (failing === "community")) {
      throw new Error("offline");
    }
    return isCommunity(path) ? { events: [sixthEvent] } : { entries: [sixth] };
  });
  await calendar.loadMonth();
  assertGrid(calendar, 42);
  assert.equal(calendar.loadError, true);
  assert.equal(calendar.isLoading, false);
  h.setHandler((path) => {
    if (isCommunity(path) === (failing === "community")) {
      throw new Error("offline");
    }
    return empty(path);
  });
  await calendar.loadMonth();
  assertGrid(calendar, 42);
  h.setHandler(empty);
  await calendar.loadMonth();
  assertGrid(calendar, 35);
  assert.equal(calendar.loadError, false);
  calendar.nextMonth();
  await flush();
  assertGrid(calendar, 42, "natural six-week months never collapse");
  calendar.willDestroy();
}

// A capped base response probes the entire sixth week, preserving occurrences.
{
  const h = await harness(390, "2026-10-20T12:00:00");
  const calendar = new h.Calendar();
  await flush();
  const base = Array.from({ length: 200 }, (_, i) =>
    event(i + 10, fifth.starts_at, fifth.ends_at)
  );
  base[0] = sixthEvent;
  const recurring = event(
    3,
    "2026-11-03T09:00:00+08:00",
    "2026-11-03T10:00:00+08:00"
  );
  h.calls.length = 0;
  h.setHandler((path, options) =>
    !isCommunity(path)
      ? { entries: [] }
      : options.data.after === calendar.fetchRange.from.toISOString()
        ? { events: base }
        : { events: [sixthEvent, recurring] }
  );
  await calendar.loadMonth();
  const probe = h.calls.filter((call) => isCommunity(call.path))[1];
  assert.ok(probe, "capped base triggers supplemental query");
  assert.equal(
    probe.data.after,
    new Date("2026-11-02T00:00:00+08:00").toISOString()
  );
  assert.equal(
    probe.data.before,
    new Date("2026-11-09T00:00:00+08:00").toISOString()
  );
  assert.equal(probe.data.limit, 200);
  assert.equal(
    calendar.communityEvents.length,
    201,
    "dedup uses event id plus occurrence start"
  );
  assertGrid(calendar, 42);
  // A failed probe cannot collapse a known expanded month.
  h.setHandler((path, options) => {
    if (!isCommunity(path)) {
      return { entries: [] };
    }
    if (options.data.after !== calendar.fetchRange.from.toISOString()) {
      throw new Error("probe offline");
    }
    return {
      events: Array.from({ length: 200 }, (_, i) =>
        event(i + 10, fifth.starts_at, fifth.ends_at)
      ),
    };
  });
  await calendar.loadMonth();
  assertGrid(calendar, 42);
  assert.equal(calendar.loadError, true);
  calendar.willDestroy();
}

{
  const resizeHarness = await harness(1440, "2026-10-20T12:00:00");
  const instance = new resizeHarness.Calendar();
  await flush();
  resizeHarness.setHandler((path, options) =>
    !isCommunity(path)
      ? { entries: [] }
      : options.data.after === instance.fetchRange.from.toISOString()
        ? {
            events: Array.from({ length: 200 }, (_, id) =>
              event(id, fifth.starts_at, fifth.ends_at)
            ),
          }
        : { events: [sixthEvent] }
  );
  await instance.loadMonth();
  resizeHarness.calls.length = 0;
  resizeHarness.resize(390);
  await flush();
  assertGrid(instance, 42);
  assert.ok(
    resizeHarness.calls.some(
      (call) =>
        call.data?.after === new Date("2026-11-02T00:00:00+08:00").toISOString()
    ),
    "entering mobile probes a previously capped desktop response"
  );
  instance.willDestroy();
}

{
  const pendingHarness = await harness(390, "2026-10-20T12:00:00");
  const instance = new pendingHarness.Calendar();
  await flush();
  let finishProbe;
  pendingHarness.setHandler((path, options) => {
    if (!isCommunity(path)) {
      return { entries: [sixth] };
    }
    if (options.data.after === instance.fetchRange.from.toISOString()) {
      return {
        events: Array.from({ length: 200 }, (_, id) =>
          event(id, fifth.starts_at, fifth.ends_at)
        ),
      };
    }
    return new Promise((resolve) => (finishProbe = resolve));
  });
  const pending = instance.loadMonth();
  await flush();
  assert.equal(instance.isLoading, true);
  assertGrid(instance, 42);
  finishProbe({ events: [] });
  await pending;
  assertGrid(instance, 42);
  instance.willDestroy();
}

{
  const h = await harness();
  const calendar = new h.Calendar();
  await flush();
  calendar.nextMonth();
  await flush();
  assert.equal(calendar.selectedDate, "2026-02-28");
  calendar.nextMonth();
  await flush();
  assert.equal(
    calendar.selectedDate,
    "2026-03-31",
    "navigation retains today's preferred day"
  );
  calendar.previousMonth();
  await flush();
  assertGrid(calendar, 35);
  const spillover = calendar.monthCells.find((cell) => !cell.inMonth);
  calendar.selectDate(spillover.key);
  await flush();
  assert.equal(calendar.selectedDate, spillover.key);
  assert.equal(
    calendar.visibleMonth.getMonth(),
    local(spillover.key).getMonth(),
    "gray date opens its natural month"
  );
  assertQueries(h, calendar);
  h.resize(1440);
  await flush();
  assertGrid(calendar, 42);
  const desktopSpill = calendar.monthCells.find((cell) => !cell.inMonth);
  calendar.selectDate(desktopSpill.key);
  await flush();
  assert.equal(
    calendar.visibleMonth.getMonth(),
    local(desktopSpill.key).getMonth()
  );
  h.resize(390);
  calendar.goToday();
  await flush();

  // Following today survives midnight and sleeping tabs; manual browsing stays put.
  h.setNow("2026-02-01T00:00:01");
  assert.equal(h.timers.size, 1);
  const timer = [...h.timers.values()][0];
  h.timers.clear();
  timer.callback();
  await flush();
  assert.equal(calendar.todayKey, "2026-02-01");
  assert.equal(calendar.selectedDate, "2026-02-01");
  calendar.nextMonth();
  await flush();
  const browsed = +calendar.visibleMonth;
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
  assert.equal(+calendar.visibleMonth, browsed);
  calendar.goToday();
  await flush();
  h.setNow("2026-02-09T08:00:00");
  h.window.emit("focus");
  await flush();
  assert.equal(calendar.selectedDate, "2026-02-09");
  assertGrid(calendar, 35);
  assertQueries(h, calendar);

  h.setHandler((path) =>
    path === "/isbf/api/entries/9.json"
      ? {
          entry: entry(9, "2027-12-31T00:00:00Z", "2028-01-01T00:00:00Z", {
            all_day: true,
          }),
        }
      : empty(path)
  );
  h.router.currentURL = "/calendar?entry_id=9";
  await calendar.focusFromRoute();
  await flush();
  assert.equal(calendar.selectedDate, "2027-12-31");
  assert.equal(key(calendar.visibleMonth), "2027-12-01");
  assert.equal(calendar.focusedEntryId, 9);
  assert.equal("mobileFocusDate" in calendar, false);
  assertGrid(calendar, 35);
  calendar.willDestroy();
}

for (const [date, hours] of [
  ["2026-03-08T00:00:00", 23],
  ["2026-11-01T00:00:00", 25],
]) {
  process.env.TZ = "America/New_York";
  const dst = await harness(390, date);
  const instance = new dst.Calendar();
  await flush();
  const { delay } = [...dst.timers.values()][0];
  assert.ok(delay >= hours * 3600000 && delay < hours * 3600000 + 1000);
  instance.willDestroy();
}
process.env.TZ = "Asia/Shanghai";

// Touch input uses one completed vertical gesture, with ordinary taps preserved.
const touch = (x, y, identifier = 1) => ({
  clientX: x,
  clientY: y,
  identifier,
});
const touches = (...points) => ({ touches: points, changedTouches: points });
for (const width of [390, 1440]) {
  const h = await harness(width, "2026-10-20T12:00:00");
  const calendar = new h.Calendar();
  await flush();
  const original = +calendar.visibleMonth;
  const swipe = (dx, dy) => {
    calendar.startSwipe(touches(touch(100, 200)));
    calendar.moveSwipe(touches(touch(100 + dx, 200 + dy)));
    calendar.endSwipe({
      touches: [],
      changedTouches: [touch(100 + dx, 200 + dy)],
    });
  };
  swipe(0, -47);
  swipe(50, -60);
  assert.equal(
    +calendar.visibleMonth,
    original,
    "threshold and direction reject gestures"
  );
  swipe(0, -80);
  await flush();
  assert.equal(calendar.visibleMonth.getMonth(), width <= 600 ? 10 : 9);
  const click = (detail = 1) => {
    let prevented = false;
    calendar.selectDate(calendar.selectedDate, {
      detail,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {},
      stopImmediatePropagation() {},
    });
    return prevented;
  };
  assert.equal(click(0), false, "keyboard activation remains available");
  assert.equal(click(), width <= 600, "generated swipe click is suppressed");
  calendar.startSwipe(touches(touch(100, 200)));
  calendar.endSwipe({ touches: [], changedTouches: [touch(100, 200)] });
  assert.equal(click(), false, "next real tap resets suppression");
  const beforeCancel = +calendar.visibleMonth;
  calendar.startSwipe(touches(touch(100, 200)));
  calendar.moveSwipe(touches(touch(100, 150), touch(120, 150, 2)));
  calendar.moveSwipe(touches(touch(100, 100)));
  calendar.endSwipe({ touches: [], changedTouches: [touch(100, 80)] });
  assert.equal(
    +calendar.visibleMonth,
    beforeCancel,
    "multi-touch cancels until all fingers lift"
  );
  calendar.startSwipe(touches(touch(100, 200)));
  calendar.cancelSwipe();
  calendar.endSwipe({ touches: [], changedTouches: [touch(100, 80)] });
  assert.equal(
    +calendar.visibleMonth,
    beforeCancel,
    "touchcancel cannot navigate"
  );
  calendar.startSwipe(touches(touch(100, 200)));
  calendar.nextMonth();
  const afterNavigation = +calendar.visibleMonth;
  calendar.endSwipe({ touches: [], changedTouches: [touch(100, 80)] });
  assert.equal(
    +calendar.visibleMonth,
    afterNavigation,
    "month changes invalidate gesture"
  );
  swipe(0, 100);
  await flush();
  assert.equal(
    calendar.visibleMonth.getMonth(),
    10,
    "downward swipe moves back on mobile"
  );
  calendar.willDestroy();
}

// Current requests win over late requests, including a late supplemental probe.
{
  const h = await harness(390, "2026-10-20T12:00:00");
  const calendar = new h.Calendar();
  await flush();
  const deferred = [];
  h.setHandler(
    (path, options) =>
      new Promise((resolve) => deferred.push({ path, options, resolve }))
  );
  const older = calendar.loadMonth();
  const base = deferred.splice(0);
  for (const request of base) {
    request.resolve(
      isCommunity(request.path)
        ? {
            events: Array.from({ length: 200 }, (_, i) =>
              event(i + 10, fifth.starts_at, fifth.ends_at)
            ),
          }
        : { entries: [] }
    );
  }
  await flush();
  const probes = deferred.splice(0);
  assert.equal(probes.length, 1);
  h.setHandler(empty);
  calendar.previousMonth();
  await flush();
  for (const request of probes) {
    request.resolve({ events: [sixthEvent] });
  }
  await older;
  assert.equal(key(calendar.visibleMonth), "2026-09-01");
  assert.equal(
    calendar.communityEvents.length,
    0,
    "late probe cannot replace current month"
  );
  assertGrid(calendar, 35);
  h.setHandler(
    (path) => new Promise((resolve) => deferred.push({ path, resolve }))
  );
  const priorOwner = calendar.loadMonth();
  calendar.currentUser = { id: 8 };
  h.setHandler(empty);
  await calendar.loadMonth();
  for (const request of deferred.splice(0)) {
    request.resolve(
      isCommunity(request.path)
        ? { events: [sixthEvent] }
        : { entries: [sixth] }
    );
  }
  await priorOwner;
  assert.equal(
    calendar.personalEntries.length,
    0,
    "old owner cannot replace personal data"
  );
  assert.equal(calendar.communityEvents.length, 0);
  // Owner changes must also clear previously learned expansion decisions.
  calendar.nextMonth();
  await flush();
  h.setHandler((path) =>
    isCommunity(path) ? { events: [] } : { entries: [sixth] }
  );
  await calendar.loadMonth();
  assertGrid(calendar, 42);
  calendar.currentUser = { id: 9 };
  h.setHandler(async () => {
    throw new Error("offline");
  });
  await calendar.loadMonth();
  assertGrid(calendar, 35);
  assert.equal(calendar.personalEntries.length, 0);
  h.setHandler(
    (path) => new Promise((resolve) => deferred.push({ path, resolve }))
  );
  const pending = calendar.loadMonth();
  calendar.isDestroying = true;
  calendar.willDestroy();
  for (const request of deferred) {
    request.resolve(
      isCommunity(request.path)
        ? { events: [sixthEvent] }
        : { entries: [sixth] }
    );
  }
  await pending;
  assert.equal(
    calendar.personalEntries.length,
    0,
    "disposed instance ignores pending results"
  );
  assert.equal(h.timers.size, 0);
  assert.equal(
    h.media.listenerCount + h.window.listenerCount + h.document.listenerCount,
    0
  );
}
process.stdout.write(
  "Calendar natural months, sixth-week decisions, gestures, ranges and lifecycle OK\n"
);
