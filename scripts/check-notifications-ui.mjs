import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const helpers = new vm.SourceTextModule(readFileSync(new URL("javascripts/discourse/lib/notification-groups.js", root), "utf8"));
await helpers.link(() => {});
await helpers.evaluate();
const { notificationsEnabled, mergeEntries } = helpers.namespace;
assert.equal(notificationsEnabled("/u/student/notifications/mentions", { username: "Student" }, { isbf_notifications_enabled: true }), true);
assert.equal(notificationsEnabled("/u/other/notifications", { username: "Student" }, { isbf_notifications_enabled: true }), false);
assert.equal(notificationsEnabled("/u/student/notifications", { username: "Student" }, {}), false);
assert.equal(notificationsEnabled("/admin", { username: "Student" }, { isbf_notifications_enabled: true }), false);
assert.deepEqual(JSON.parse(JSON.stringify(mergeEntries([{ key: "latest" }], [{ key: "latest" }, { key: "older" }]))), [{ key: "latest" }, { key: "older" }]);

const requests = [];
let transformed = 0;
class Component { constructor(_owner, args = {}) { this.args = args; this.appEvents = { on() {}, off() {} }; } }
class Notification {
  static async initializeNotifications(raw) { transformed += raw.length; return raw.map((data) => ({ ...data, set(key, value) { this[key] = value; } })); }
}
class Item { constructor(data) { Object.assign(this, data); } }
const exports = { default: Component, tracked() {}, action() {}, service() {}, scheduleOnce() {}, fn() {}, on() {}, themePrefix: (key) => key, ajax: (_url, options) => new Promise((resolve, reject) => requests.push({ resolve, reject, options })), i18n: (key) => key, consumeInitialNotificationTab: () => "all" };
const source = readFileSync(new URL("javascripts/discourse/components/isbf-notifications.gjs", root), "utf8").replace(/<template>[\s\S]*?<\/template>/g, "").replace(/@service\s+\w+;\s*/g, "").replace(/@(tracked|action)\s+/g, "");
const module = new vm.SourceTextModule(source);
await module.link((name) => {
  let values = exports;
  if (name === "discourse/models/notification") { values = { default: Notification }; }
  if (name === "discourse/lib/user-menu/notification-item") { values = { default: Item }; }
  return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) { this.setExport(key, value); } });
});
await module.evaluate();
const component = new module.namespace.default();
component.currentUser = { username: "student" };
const stale = component.loadMore();
component.selectTab("mentions");
const native = { id: 1, read: false, notification_type: 1 };
const latest = { key: "entry-1", notification: native };
requests[1].resolve({ groups: [{ key: "notification-1", kind: "standalone", latest }], next_cursor: null });
await new Promise((resolve) => setImmediate(resolve));
requests[0].resolve({ groups: [{ key: "notification-2", kind: "standalone", latest: { ...latest, key: "entry-2", notification: { ...native, id: 2 } } }], next_cursor: "old" });
await stale;
assert.equal(component.tab, "mentions");
assert.equal(component.groups.length, 1);
assert.equal(component.groups[0].key, "notification-1");
assert.equal(component.nextCursor, null);
assert.equal(component.loading, false);
const entries = await component.prepareEntries([{ ...latest, key: "synthetic-actor" }]);
assert.equal(entries[0].notification, component.groups[0].latest.notification);
assert.equal(transformed, 2);
entries[0].notification.set("read", true);
assert.equal(component.groups[0].latest.notification.read, true);
console.log("Notification ownership/fallback, detail dedup, stale-tab responses and shared native models OK");

let routeWillChange;
let override;
let redirected;
let selectedTab;
const adapter = new vm.SourceTextModule(readFileSync(new URL("javascripts/discourse/api-initializers/isbf-notifications.gjs", root), "utf8"));
await adapter.link((name) => new vm.SyntheticModule(name === "discourse/lib/api" ? ["apiInitializer"] : ["setInitialNotificationTab"], function () {
  if (name === "discourse/lib/api") { this.setExport("apiInitializer", (callback) => callback); }
  else { this.setExport("setInitialNotificationTab", (tab) => { selectedTab = tab; }); }
}));
await adapter.evaluate();
const services = {
  "service:router": { on(_event, callback) { routeWillChange = callback; }, replaceWith(path) { redirected = path; } },
  "service:site-settings": { isbf_notifications_enabled: true },
  "service:current-user": { username: "student" },
  "service:app-events": { trigger() {} },
};
adapter.namespace.default({ container: { lookup: (name) => services[name] }, modifyClass(_name, value) { override = value; } });
let aborted = false;
const transition = (username, name) => ({ to: { name, find: (predicate) => [{ params: { username } }].find(predicate) }, abort() { aborted = true; } });
routeWillChange(transition("student", "userNotifications.mentions"));
assert.equal(aborted, true);
assert.equal(redirected, "/u/student/notifications");
assert.equal(selectedTab, "mentions");
aborted = false;
routeWillChange(transition("other", "userNotifications.mentions"));
assert.equal(aborted, false);
services["service:site-settings"].isbf_notifications_enabled = false;
routeWillChange(transition("student", "userNotifications.responses"));
assert.equal(aborted, false);
const nativeResult = { native: true };
const route = { modelFor: () => ({ get: () => "student" }), _super: () => nativeResult };
assert.equal(override.model.call(route), nativeResult);
services["service:site-settings"].isbf_notifications_enabled = true;
assert.equal(override.model.call(route).content.length, 0);
console.log("Native child-route interception and disabled-plugin fallback OK");
