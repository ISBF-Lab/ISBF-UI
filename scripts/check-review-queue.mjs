import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const source = (path) =>
  readFileSync(new URL(path, root), "utf8").replace(/^\uFEFF/, "");
const serviceSource = source(
  "javascripts/discourse/services/isbf-review-queue.js"
)
  .replace(/@service\s+(\w+);/g, "$1;")
  .replace(/@tracked\s+/g, "");
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function emitter() {
  const listeners = new Map();
  return {
    listeners,
    on(name, callback) {
      assert.ok(!listeners.has(name), `Duplicate listener: ${name}`);
      listeners.set(name, callback);
    },
    off(name, callback) {
      assert.equal(listeners.get(name), callback);
      listeners.delete(name);
    },
    emit(name) {
      listeners.get(name)?.();
    },
  };
}
async function setup(user = { id: 1, can_review: true }) {
  const requests = [];
  const observers = new Map();
  const events = emitter();
  const router = emitter();
  const visibility = emitter();
  const document = {
    visibilityState: "visible",
    addEventListener: visibility.on,
    removeEventListener: visibility.off,
  };
  const context = vm.createContext({ document });
  class Service {
    willDestroy() {
      this.isDestroying = true;
    }
  }
  const dependencies = {
    "@glimmer/tracking": { tracked() {} },
    "@ember/service": { default: Service, service() {} },
    "@ember/object/observers": {
      addObserver(target, path, receiver, callback, sync) {
        assert.equal(target, receiver);
        assert.equal(sync, true);
        observers.set(path, callback);
      },
      removeObserver(_target, path, _receiver, callback) {
        assert.equal(observers.get(path), callback);
        observers.delete(path);
      },
    },
    "discourse/lib/ajax": {
      ajax(url) {
        assert.equal(url, "/review/count.json");
        return new Promise((resolve, reject) =>
          requests.push({ resolve, reject })
        );
      },
    },
  };
  const module = new vm.SourceTextModule(serviceSource, { context });
  await module.link((name) => {
    const exports = dependencies[name];
    assert.ok(exports, `Unexpected dependency: ${name}`);
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [key, value] of Object.entries(exports)) {
          this.setExport(key, value);
        }
      },
      { context }
    );
  });
  await module.evaluate();
  const queue = new module.namespace.default();
  Object.assign(queue, { currentUser: user, appEvents: events, router });
  return {
    queue,
    requests,
    events,
    router,
    document,
    visibility,
    observers,
    actorChanged(path = "currentUser") {
      observers.get(path)?.();
    },
  };
}

const state = await setup();
const { queue, requests, events, router } = state;
assert.equal(queue.canReview, true);
assert.equal(queue.hasPending, false, "Unknown count uses the normal state");
queue.start();
queue.start();
assert.equal(requests.length, 1, "Repeated start shares one initial request");
assert.equal(state.observers.size, 3);
requests[0].resolve({ count: 3 });
await flush();
assert.equal(queue.hasPending, true);
router.emit("routeDidChange");
assert.equal(
  queue.hasPending,
  true,
  "Viewing home/review never clears pending"
);
requests[1].reject(new Error("offline"));
await flush();
assert.equal(queue.hasPending, true, "Failure retains the confirmed count");
router.emit("routeDidChange");
requests[2].resolve({ count: 0 });
await flush();
assert.equal(queue.hasPending, false, "Only a confirmed zero clears pending");
events.emit("user-reviewable-count:changed");
requests[3].resolve({ count: 2 });
await flush();
assert.equal(queue.hasPending, true, "A later pending item restores the alert");
events.emit("user-reviewable-count:changed");
events.emit("user-reviewable-count:changed");
events.emit("user-reviewable-count:changed");
router.emit("routeDidChange");
assert.equal(
  requests.length,
  5,
  "Concurrent triggers share the active request"
);
requests[4].resolve({ count: 2 });
await flush();
assert.equal(requests.length, 6, "An in-flight signal schedules one follow-up");
requests[5].resolve({ count: 0 });
await flush();
assert.equal(
  queue.hasPending,
  false,
  "The last event cannot be lost in-flight"
);
state.document.visibilityState = "hidden";
state.visibility.emit("visibilitychange");
assert.equal(requests.length, 6);
state.document.visibilityState = "visible";
state.visibility.emit("visibilitychange");
assert.equal(requests.length, 7);
requests[6].resolve({ count: 4 });
await flush();
events.emit("user-reviewable-count:changed");
requests[7].resolve({ count: "0" });
await flush();
assert.equal(queue.hasPending, true, "Malformed counts retain confirmed state");

router.emit("routeDidChange");
const stale = requests.at(-1);
queue.currentUser = { id: 2, can_review: true };
assert.equal(queue.hasPending, false, "A new actor cannot see the old alert");
state.actorChanged();
const fresh = requests.at(-1);
assert.notEqual(fresh, stale);
fresh.resolve({ count: 0 });
await flush();
stale.resolve({ count: 9 });
await flush();
assert.equal(queue.hasPending, false, "A previous actor response is discarded");

router.emit("routeDidChange");
const revoked = requests.at(-1);
queue.currentUser.can_review = false;
state.actorChanged("currentUser.can_review");
const beforeRevoke = requests.length;
assert.equal(queue.canReview, false);
events.emit("user-reviewable-count:changed");
router.emit("routeDidChange");
assert.equal(
  requests.length,
  beforeRevoke,
  "Unauthorized actors never request"
);
revoked.resolve({ count: 7 });
await flush();
assert.equal(queue.hasPending, false);
queue.currentUser.can_review = true;
state.actorChanged("currentUser.can_review");
requests.at(-1).reject(new Error("offline"));
await flush();
assert.equal(
  queue.hasPending,
  false,
  "Permission changes reset confirmed state"
);
router.emit("routeDidChange");
requests.at(-1).resolve({ count: 1 });
await flush();
assert.equal(queue.hasPending, true);
queue.currentUser.id = 3;
state.actorChanged("currentUser.id");
assert.equal(queue.hasPending, false, "Actor id changes also reset state");
requests.at(-1).resolve({ count: 2 });
await flush();
router.emit("routeDidChange");
const destroyedRequest = requests.at(-1);
queue.willDestroy();
assert.equal(events.listeners.size, 0);
assert.equal(router.listeners.size, 0);
assert.equal(state.visibility.listeners.size, 0);
assert.equal(state.observers.size, 0);
assert.equal(queue.hasPending, false);
const beforeDestroy = requests.length;
queue.start();
destroyedRequest.resolve({ count: 10 });
await flush();
assert.equal(
  queue.hasPending,
  false,
  "Late responses cannot revive destroyed state"
);
assert.equal(requests.length, beforeDestroy);

for (const user of [null, { id: 4, can_review: false }]) {
  const guest = await setup(user);
  guest.queue.start();
  guest.events.emit("user-reviewable-count:changed");
  guest.router.emit("routeDidChange");
  assert.equal(guest.queue.canReview, false);
  assert.equal(guest.requests.length, 0);
  guest.queue.willDestroy();
}
const unknown = await setup();
unknown.queue.start();
unknown.requests[0].reject(new Error("offline"));
await flush();
assert.equal(unknown.queue.hasPending, false);
unknown.router.emit("routeDidChange");
unknown.requests[1].resolve({ count: 1 });
await flush();
assert.equal(unknown.queue.hasPending, true);
unknown.queue.willDestroy();

const permissionRace = await setup();
permissionRace.queue.start();
const beforePermissionChange = permissionRace.requests[0];
permissionRace.queue.currentUser.can_review = false;
permissionRace.actorChanged("currentUser.can_review");
permissionRace.queue.currentUser.can_review = true;
permissionRace.actorChanged("currentUser.can_review");
assert.equal(permissionRace.requests.length, 2);
permissionRace.requests[1].resolve({ count: 0 });
await flush();
beforePermissionChange.resolve({ count: 9 });
await flush();
assert.equal(
  permissionRace.queue.hasPending,
  false,
  "Revoking and restoring permission invalidates the old request generation"
);
permissionRace.queue.willDestroy();
const initializer = new vm.SourceTextModule(
  source("javascripts/discourse/api-initializers/isbf-review-queue.js")
);
let starts = 0;
let registrations = 0;
let registered = false;
class QueueService {}
const nativeRouter = {};
const owner = {
  hasRegistration(name) {
    assert.equal(name, "service:isbf-review-queue");
    return registered;
  },
  register(name, klass) {
    assert.equal(name, "service:isbf-review-queue");
    assert.equal(klass, QueueService);
    registrations++;
    registered = true;
  },
  lookup(name) {
    assert.equal(name, "service:isbf-review-queue");
    return { start: () => starts++ };
  },
};
const initializerDependencies = {
  "@ember/owner": {
    getOwner(routerService) {
      assert.equal(routerService, nativeRouter);
      return owner;
    },
  },
  "discourse/lib/api": { apiInitializer: (callback) => callback },
  "../services/isbf-review-queue": { default: QueueService },
};
await initializer.link((name) => {
  const values = initializerDependencies[name];
  assert.ok(values, `Unexpected initializer dependency: ${name}`);
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) {
      this.setExport(key, value);
    }
  });
});
await initializer.evaluate();
const api = {
  container: {
    lookup(name) {
      assert.equal(name, "service:router");
      return nativeRouter;
    },
  },
};
initializer.namespace.default(api);
initializer.namespace.default(api);
assert.equal(
  registrations,
  1,
  "Registration uses owner, once, not API container"
);
assert.equal(
  starts,
  2,
  "Repeated boot delegates to the idempotent start method"
);
process.stdout.write("Review queue state and lifecycle checks passed.\n");
