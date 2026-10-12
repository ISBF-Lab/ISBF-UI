import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const context = vm.createContext({ setTimeout: () => 1, clearTimeout() {} });
const calls = [];
let response;
let failure;
const ajax = async (...args) => {
  calls.push(args);
  if (failure) {
    throw failure;
  }
  return response;
};
const synthetic = (values) =>
  new vm.SyntheticModule(
    Object.keys(values),
    function () {
      for (const [key, value] of Object.entries(values)) {
        this.setExport(key, value);
      }
    },
    { context },
  );
async function load(path, dependencies = {}) {
  const module = new vm.SourceTextModule(read(path), { context });
  await module.link((name) => {
    assert.ok(dependencies[name], `Unexpected import ${name} in ${path}`);
    return dependencies[name] instanceof vm.Module
      ? dependencies[name]
      : synthetic(dependencies[name]);
  });
  await module.evaluate();
  return module;
}

const helperPath = "javascripts/discourse/lib/pinning.js";
const helper = await load(helperPath, {
  "discourse/lib/ajax": { ajax },
});
const { isPinningContext, pinningMeta, pinDeadline, saveHomePin } =
  helper.namespace;
assert.equal(typeof isPinningContext, "function");
assert.equal(typeof pinningMeta, "function");
assert.equal(typeof saveHomePin, "function");

const site = {
  isbf_pinning: { enabled: true, official_category_id: 6 },
};
for (const url of [
  "/",
  "/latest",
  "/latest?foo=1",
  "/c/official/6/l/latest",
  "/c/official/6",
]) {
  assert.equal(isPinningContext({ currentURL: url }, site, {}), true, url);
}
for (const url of [
  "/top",
  "/new",
  "/isbf/teamup",
  "/isbf/marketplace",
  "/search",
  "/u/alan/activity",
  "/c/feedback/2/l/latest",
  "/c/official/6/l/top",
]) {
  assert.equal(isPinningContext({ currentURL: url }, site, {}), false, url);
}
assert.equal(isPinningContext({ currentURL: "/latest" }, {}, {}), false);
const clock = Date.now();
const makePin = (id, created, pinned, until) => ({
  id,
  created_at: new Date(created).toISOString(),
  isbf_home_pinning: {
    can_manage: true,
    scoped: true,
    active: true,
    pinned_at: new Date(pinned).toISOString(),
    pinned_until: new Date(until).toISOString(),
  },
});
const early = makePin(1, clock - 10000, clock - 4000, clock + 100);
const later = makePin(2, clock - 9000, clock - 2000, clock + 200);
const unpinned = { id: 3, created_at: new Date(clock).toISOString() };
for (const changes of [
  { scoped: false },
  { active: false },
  { pinned_at: "invalid" },
  { pinned_until: "invalid" },
  { pinned_until: new Date(clock).toISOString() },
]) {
  assert.equal(
    pinningMeta(
      { isbf_home_pinning: { ...early.isbf_home_pinning, ...changes } },
      clock,
    ).active,
    false,
  );
}
const original = early.isbf_home_pinning;
failure = new Error("Network failed");
await assert.rejects(
  saveHomePin(early, {
    enabled: true,
    until: later.isbf_home_pinning.pinned_until,
  }),
);
assert.equal(early.isbf_home_pinning, original);
failure = null;
response = {};
await assert.rejects(saveHomePin(early, { enabled: false }));
assert.equal(early.isbf_home_pinning, original);
response = { isbf_home_pinning: { scoped: true, active: false } };
early.pinned = true;
early.latest_created_order_pinned_at = "old";
await saveHomePin(early, { enabled: false });
assert.equal(early.pinned, false);
assert.equal(early.latest_created_order_pinned_at, null);
const [url, request] = calls.at(-1);
assert.equal(url, "/t/1/status");
assert.equal(request.type, "PUT");
assert.equal(request.data.status, "pinned_globally");
assert.equal(request.data.isbf_home_pin, true);
assert.equal(request.data.enabled, false);
early.isbf_home_pinning = original;
const { sortHomePinList, PinExpiryScheduler } = helper.namespace;
const list = { isbfHomePinScope: true, topics: [unpinned, early, later] };
sortHomePinList(list, clock);
assert.deepEqual(
  Array.from(list.topics, (item) => item.id),
  [2, 1, 3],
);
const untouched = { topics: [unpinned, early, later] };
const originalTopics = untouched.topics;
sortHomePinList(untouched, clock);
assert.equal(untouched.topics, originalTopics);
let now = clock;
let currentTimer;
let notifications = 0;
let enabled = true;
const scheduler = new PinExpiryScheduler({
  now: () => now,
  enabled: () => enabled,
  onChange: () => notifications++,
  setTimer(callback, delay) {
    currentTimer = { callback, delay };
    return currentTimer;
  },
  clearTimer(timer) {
    if (timer === currentTimer) {
      currentTimer = null;
    }
  },
});
scheduler.register(list);
assert.equal(currentTimer.delay, 101);
now = clock + 101;
currentTimer.callback();
assert.deepEqual(
  Array.from(list.topics, (item) => item.id),
  [2, 3, 1],
);
assert.equal(notifications, 1);
assert.equal(currentTimer.delay, 100);
now = clock + 201;
currentTimer.callback();
assert.deepEqual(
  Array.from(list.topics, (item) => item.id),
  [3, 2, 1],
);
assert.equal(currentTimer, null);
later.isbf_home_pinning.pinned_until = new Date(clock + 5000).toISOString();
scheduler.refresh();
assert.ok(currentTimer);
enabled = false;
scheduler.refresh();
assert.equal(currentTimer, null, "Route outside scope stops timer");
enabled = true;
scheduler.refresh();
assert.ok(currentTimer);
scheduler.remove(list);
assert.equal(currentTimer, null);
scheduler.register(list);
scheduler.destroy();
assert.equal(currentTimer, null);

function componentClass(path, globals = {}) {
  const source = read(path);
  const className = source.match(/export default class (\w+)/)?.[1];
  assert.ok(className, `${path} exports a component`);
  const body =
    source
      .slice(
        source.indexOf("export default class"),
        source.indexOf("  <template>"),
      )
      .replace("export default ", "")
      .replace(/^\s*@service \w+;\s*$/gm, "")
      .replace(/^\s*@(tracked|action)\s*/gm, "") + "}";
  return vm.runInNewContext(`${body}\n${className}`, {
    Component: class {
      constructor(args = {}) {
        this.args = args;
      }

      willDestroy() {}
    },
    Date,
    ...globals,
  });
}

const renderCallbacks = [];
const registered = [];
const removed = [];
const modalCalls = [];
const Card = componentClass(
  "javascripts/discourse/components/isbf-v2-feed-card.gjs",
  {
    isPinningContext,
    pinningMeta,
    saveHomePin,
    isReportedHidden: () => false,
    ISBFHomePinDialog: class {},
    document: { removeEventListener() {} },
    schedule(queue, callback) {
      assert.equal(queue, "afterRender");
      renderCallbacks.push(callback);
    },
  },
);
Card.prototype.appEvents = {
  on: (...args) => registered.push(args),
  off: (...args) => removed.push(args),
  trigger() {},
};
const future = new Date(Date.now() + 86400000).toISOString();
const topic = {
  id: 12,
  isbf_home_pinning: {
    can_manage: true,
    scoped: true,
    active: true,
    pinned_at: new Date(Date.now() - 1000).toISOString(),
    pinned_until: future,
  },
};
const card = new Card({ topic });
card.router = { currentURL: "/latest" };
card.site = {
  isbf_pinning: { enabled: true, home_actions_enabled: true },
};
card.siteSettings = {};
card.modal = { show: (...args) => modalCalls.push(args) };
for (const user of [null, {}, { staff: true }, { moderator: true }]) {
  card.currentUser = user;
  assert.equal(card.canManageHomePin, false, "Only admin may manage pins");
}
card.currentUser = { admin: true };
assert.equal(card.canManageHomePin, true);
card.menuOpen = true;
const opening = card.openHomePin();
const duplicate = card.openHomePin();
assert.equal(card.menuOpen, false);
assert.equal(
  modalCalls.length,
  0,
  "Menu finishes rendering before modal opens",
);
for (const callback of renderCallbacks.splice(0)) {
  callback();
}
await Promise.all([opening, duplicate]);
assert.equal(modalCalls.length, 1, "Repeated clicks open one modal");
card.site = {};
assert.equal(
  card.canManageHomePin,
  false,
  "No clickable action without plugin",
);
card.willDestroy();
assert.ok(registered.some(([name]) => name === "isbf:home-pins-changed"));
assert.ok(removed.some(([name]) => name === "isbf:home-pins-changed"));

const styles = read("stylesheets/pinning.scss");
assert.match(styles, /min-height:\s*44px/);
assert.match(styles, /width\s*<=\s*600px/);
assert.match(styles, /width\s*>=\s*601px/);
assert.match(styles, /env\(safe-area-inset-bottom\)/);
assert.match(styles, /var\(--isbf-v2-feed-left\)/);
assert.match(styles, /var\(--isbf-v2-feed-width\)/);

let resolveSave;
let rejectSave;
const saves = [];
let closed = 0;
let saved = 0;
const Dialog = componentClass(
  "javascripts/discourse/components/isbf-home-pin-dialog.gjs",
  {
    pinDeadline,
    pinningMeta,
    themePrefix: (key) => key,
    i18n: (key) => key,
    saveHomePin(...args) {
      saves.push(args);
      return new Promise((resolve, reject) => {
        resolveSave = resolve;
        rejectSave = reject;
      });
    },
  },
);
const dialogArgs = (value = {}) => ({
  model: { topic: value, onSaved: () => saved++ },
  closeModal: () => closed++,
});
const start = Date.now();
const fresh = new Dialog(dialogArgs());
assert.ok(Math.abs(Date.parse(fresh.until) - start - 3 * 86400000) < 1000);
const edit = new Dialog(dialogArgs(topic));
assert.equal(edit.until, future, "Retiming retains current deadline");
assert.equal(
  pinDeadline("2026-10-15 15:10+08:00")?.toISOString(),
  "2026-10-15T07:10:00.000Z",
);
assert.equal(
  pinDeadline("2026-10-15 15:10 +08:00")?.toISOString(),
  "2026-10-15T07:10:00.000Z",
);
for (const invalid of [
  null,
  "",
  "bad-date",
  "2026-13-15 15:10+08:00",
  "2026-10-15 25:10+08:00",
  new Date(0).toISOString(),
]) {
  fresh.updateUntil(invalid);
  await fresh.submit();
  assert.ok(fresh.errorMessage);
}
assert.equal(saves.length, 0);
const nativeDeadline = "2099-10-15 15:10+08:00";
fresh.updateUntil(nativeDeadline);
const submitting = fresh.submit();
await fresh.submit();
assert.equal(saves.length, 1);
assert.equal(saves[0][1].until, "2099-10-15T07:10:00.000Z");
assert.equal(fresh.submitDisabled, true);
fresh.updateUntil("ignored");
assert.equal(fresh.until, nativeDeadline);
rejectSave({ jqXHR: { responseJSON: { errors: ["Denied"] } } });
await submitting;
assert.equal(fresh.errorMessage, "Denied");
assert.equal(fresh.until, nativeDeadline);
assert.equal(fresh.submitDisabled, false);
assert.equal(closed, 0);
const retry = fresh.submit();
resolveSave({ active: true });
await retry;
assert.equal(saves.length, 2);
assert.equal(saved, 1);
assert.equal(closed, 1);
const cancelled = new Dialog(dialogArgs());
cancelled.close();
await cancelled.submit();
assert.equal(saves.length, 2, "Cancel does not save");
const destroyed = new Dialog(dialogArgs());
const pending = destroyed.submit();
destroyed.willDestroy();
resolveSave({ active: true });
await pending;
assert.equal(saved, 1, "Late responses do not update destroyed dialog");
assert.equal(closed, 2);
const modalSource = read(
  "javascripts/discourse/components/isbf-home-pin-dialog.gjs",
);
assert.match(modalSource, /@noRelativeOptions={{true}}/);
assert.match(modalSource, /@clearable={{false}}/);
assert.match(modalSource, /on "submit" this.submit/);
assert.match(modalSource, /role="alert"/);
assert.match(modalSource, /@closeModal={{this.close}}/);
const lifecycle = [];
const wrappers = {};
let destructor;
let transformer;
class TopicList {
  static munge(json) {
    return { topics: json.topic_list.topics };
  }

  init() {
    lifecycle.push(["init", this]);
    return "initialized";
  }

  willDestroy() {
    lifecycle.push(["willDestroy", this]);
  }

  get loadMore() {
    return async function (argument) {
      lifecycle.push(["loadMore", this, argument]);
      this.topics.push(unpinned);
      return "more";
    };
  }

  async loadBefore(argument) {
    lifecycle.push(["loadBefore", this, argument]);
    this.topics.push(later);
    return "before";
  }
}
const eventNames = [];
const cleanupNames = [];
const router = {
  currentURL: "/latest",
  on: (name) => eventNames.push(name),
  off: (name) => cleanupNames.push(name),
};
const events = {
  on: (name) => eventNames.push(name),
  off: (name) => cleanupNames.push(name),
  trigger() {},
};
const initializer = await load(
  "javascripts/discourse/api-initializers/isbf-topic-pinning.gjs",
  {
    "@ember/destroyable": {
      registerDestructor: (owner, callback) => {
        destructor = callback;
      },
    },
    "discourse/lib/api": { apiInitializer: (callback) => callback },
    "../lib/pinning": helper,
  },
);
initializer.namespace.default({
  container: {
    lookup: (name) =>
      ({
        "service:router": router,
        "service:site": site,
        "service:site-settings": {},
        "service:app-events": events,
      })[name],
    factoryFor: () => ({ class: TopicList }),
  },
  registerValueTransformer: (name, callback) => {
    transformer = callback;
  },
  addModelMethod: (model, name, callback) => {
    wrappers[name] = callback;
  },
});
const ordinary = TopicList.munge({ topic_list: { topics: [] } });
assert.equal(ordinary.isbfHomePinScope, false);
const scoped = TopicList.munge({
  topic_list: { topics: [early], isbf_home_pinning_scope: true },
});
assert.equal(scoped.isbfHomePinScope, true);
const values = [unpinned, later];
assert.equal(
  transformer({
    value: values,
    context: { result: { topic_list: {} }, opts: {} },
  }),
  values,
);
assert.equal(wrappers.init.call(scoped), "initialized");
assert.equal(await wrappers.loadMore.call(scoped, "page2"), "more");
assert.equal(await wrappers.loadBefore.call(scoped, "newer"), "before");
assert.deepEqual(
  Array.from(scoped.topics, (item) => item.id),
  [2, 1, 3],
);
assert.equal(
  lifecycle[1][1],
  scoped,
  "Getter-wrapped native method preserves this",
);
assert.equal(lifecycle[1][2], "page2");
assert.equal(lifecycle[2][2], "newer");
wrappers.willDestroy.call(scoped);
assert.equal(lifecycle.at(-1)[0], "willDestroy");
assert.ok(eventNames.includes("routeDidChange"));
assert.ok(eventNames.includes("isbf:home-pin-saved"));
destructor();
assert.ok(cleanupNames.includes("routeDidChange"));
assert.ok(cleanupNames.includes("isbf:home-pin-saved"));

console.log("Topic pinning UI checks passed");
