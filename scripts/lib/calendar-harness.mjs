import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
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

async function harness(
  width = 390,
  date = "2026-01-31T12:00:00",
  { officialOccursOn = () => false } = {}
) {
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
    "@ember/helper": { concat: null, fn: null },
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
    "../lib/calendar-entry": {
      calendarEntryKind: (entry) =>
        entry.source_item_id ? "official" : "personal",
      calendarEntryTime: () => "",
    },
    "../lib/official-calendar": {
      officialDateKey: (value) => value.slice(0, 10),
      officialOccursOn,
      officialTimeLabel: () => "",
    },
    "./isbf-calendar-reminder-dialog": { default: null },
    "./isbf-calendar-note-editor": { default: null },
    "./isbf-calendar-entry-editor": { default: null },
    "./isbf-calendar-subscribe": { default: null },
    "./isbf-calendar-update-dialog": { default: null },
  };
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

export { harness, flush, key, local };
