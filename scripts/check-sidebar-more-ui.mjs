import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../javascripts/discourse/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const context = vm.createContext({});
const settings = {
  feedback_category_id: 2,
  official_path: "/c/official/6/l/latest",
  show_right_rail: true,
};
class Component {
  constructor(args = {}) {
    this.args = args;
  }
}
const common = {
  default: Component,
  action: (value) => value,
  service: () => {},
  fn:
    (fn, ...args) =>
    (...rest) =>
      fn(...args, ...rest),
  getOwner: () => ({ lookup: () => ({ get: () => null }) }),
  i18n: (value) => value,
  settings,
  themePrefix: (value) => value,
  notificationsEnabled: () => false,
  isFeedStyleTopic: () => false,
};
const dummy = new vm.SyntheticModule(
  Object.keys(common),
  function () {
    for (const [key, value] of Object.entries(common)) {
      this.setExport(key, value);
    }
  },
  { context },
);
const helpers = new vm.SourceTextModule(read("lib/feedback-category.js"), {
  context,
});
await helpers.link(() => {});
await helpers.evaluate();
const { feedbackCategory, isFeedbackPath, feedbackHref, feedbackComposeHref } =
  helpers.namespace;
const category = { id: 2, url: "/c/site-feedback/2", canCreateTopic: true };
const site = { categories: [category, { id: 3, url: "/c/staff/3" }] };
assert.equal(feedbackCategory(site, "2"), category);
for (const id of [0, -2, 2.1, "bad", 99, undefined]) {
  assert.equal(feedbackCategory(site, id), null);
}
assert.equal(feedbackCategory({ categories: [] }, 2), null);
for (const path of [
  "/c/2",
  "/c/site-feedback/2",
  "/c/site-feedback/2/l/latest",
  "/c/2/l/top?period=monthly",
]) {
  assert.equal(isFeedbackPath(path, category), true, path);
}
for (const path of [
  "/latest",
  "/categories",
  "/c/general/4",
  "/c/site-feedback/20",
  "/c/staff/3",
  "/u/person/preferences",
  "/t/feedback/2",
  "/c/site-feedback/2/l/latest/extra",
]) {
  assert.equal(isFeedbackPath(path, category), false, path);
}
assert.equal(isFeedbackPath("/c/2", null), false);
assert.equal(feedbackHref(category), "/c/site-feedback/2/l/latest");
assert.equal(feedbackHref({ id: 2 }), "/c/2/l/latest");
assert.equal(feedbackHref(null), null);
assert.equal(feedbackComposeHref(category), "/new-topic?category_id=2");

async function loadComponent(path) {
  const module = new vm.SourceTextModule(
    read(path)
      .replace(/<template>[\s\S]*?<\/template>/g, "")
      .replace(/@(service|action)\s+/g, ""),
    { context },
  );
  await module.link((specifier) =>
    specifier.endsWith("feedback-category") ? helpers : dummy,
  );
  await module.evaluate();
  return module.namespace.default;
}
const Menu = await loadComponent("components/isbf-v2-more-menu.gjs");
const menu = new Menu();
const calls = [];
const native = { close: async () => calls.push("close") };
menu.router = { transitionTo: (path) => calls.push(path) };
menu.dialog = { alert: async (message) => calls.push(message) };
menu.modal = { show: (component) => calls.push(component) };
menu.site = site;
await menu.openSettings(native);
assert.deepEqual(calls.splice(0), ["close", "/login"]);
for (const role of [
  { username: "student" },
  { username: "moderator", moderator: true },
  { username: "developer", admin: true },
]) {
  menu.currentUser = role;
  await menu.openSettings(native);
  assert.deepEqual(calls.splice(0), [
    "close",
    `/u/${role.username}/preferences`,
  ]);
}
await menu.openFeedback(native);
assert.deepEqual(calls.splice(0), ["close", "/c/site-feedback/2/l/latest"]);
menu.site = { categories: [] };
await menu.openFeedback(native);
assert.deepEqual(calls.splice(0), ["close", "isbf_v2.feedback_unavailable"]);
await menu.openJoin(native);
assert.deepEqual(calls.splice(0), ["close", Component]);

const Shell = await loadComponent("components/isbf-v2-shell.gjs");
const shell = new Shell();
shell.site = site;
shell.siteSettings = {};
shell.router = { currentURL: "/c/site-feedback/2/l/latest" };
assert.equal(shell.pageKind, "feed");
assert.equal(shell.isFeedback, true);
assert.equal(shell.composeHref, "/new-topic?category_id=2");
assert.equal(shell.canCompose, true);
shell.currentUser = { username: "student" };
assert.equal(shell.canCompose, true);
category.canCreateTopic = false;
assert.equal(shell.canCompose, false);
assert.equal(shell.showMobileCompose, false);
category.canCreateTopic = true;
assert.equal(shell.showMobileReview, false);
assert.equal(shell.shellClass.includes("isbf-v2-shell--feedback"), true);
shell.router.currentURL = "/latest";
assert.equal(shell.isFeedback, false);
assert.equal(shell.composeHref, "/new-topic");
shell.router.currentURL = "/c/general/4/l/latest";
assert.equal(shell.pageKind, "explore");

const Connector = await loadComponent(
  "connectors/topic-list-item/isbf-feed-card.gjs",
);
const connector = new Connector({ outletArgs: { bulkSelectEnabled: false } });
connector.site = site;
connector.router = { currentURL: "/c/site-feedback/2/l/latest" };
assert.equal(connector.shouldRenderCard, true);
connector.args.outletArgs.bulkSelectEnabled = true;
assert.equal(connector.shouldRenderCard, false);
connector.args.outletArgs.bulkSelectEnabled = false;
connector.router.currentURL = "/c/general/4/l/latest";
assert.equal(connector.shouldRenderCard, false);

const Join = await loadComponent("components/isbf-v2-join-modal.gjs");
const join = new Join();
assert.equal(join.description, "isbf_v2.join_us_pending");
settings.join_us_description = "开发、运营\n联系：team@example.invalid";
assert.equal(join.description, settings.join_us_description);
console.log(
  "Sidebar actions, feedback category visibility/routes/permissions, card reuse and recruitment settings OK",
);
