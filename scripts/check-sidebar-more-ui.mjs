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
const officialHelpers = new vm.SourceTextModule(
  read("lib/official-filters.js"),
  {
    context,
  },
);
await officialHelpers.link(() => {});
await officialHelpers.evaluate();
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
  await module.link((specifier) => {
    if (specifier.endsWith("feedback-category")) {
      return helpers;
    }
    if (specifier.endsWith("official-filters")) {
      return officialHelpers;
    }
    return dummy;
  });
  await module.evaluate();
  return module.namespace.default;
}
const UtilityActions = await loadComponent(
  "components/isbf-v2-utility-actions.gjs",
);
const calls = [];
const native = { close: async () => calls.push("close") };
for (const menu of [native, undefined]) {
  const actions = new UtilityActions({ menu });
  actions.router = { transitionTo: (path) => calls.push(path) };
  actions.dialog = { alert: async (message) => calls.push(message) };
  actions.modal = { show: (component) => calls.push(component) };
  actions.site = site;
  const before = menu ? ["close"] : [];
  assert.deepEqual(
    Array.from(actions.items, (item) => item.key),
    ["settings", "feedback", "join"],
  );
  await actions.openSettings();
  assert.deepEqual(calls.splice(0), [...before, "/login"]);
  for (const role of [
    { username: "student" },
    { username: "moderator", moderator: true },
    { username: "developer", admin: true },
    { username: "名字 /?" },
  ]) {
    actions.currentUser = role;
    await actions.openSettings();
    assert.deepEqual(calls.splice(0), [
      ...before,
      `/u/${encodeURIComponent(role.username)}/preferences`,
    ]);
  }
  await actions.openFeedback();
  assert.deepEqual(calls.splice(0), [...before, "/c/site-feedback/2/l/latest"]);
  actions.site = { categories: [] };
  await actions.openFeedback();
  assert.deepEqual(calls.splice(0), [
    ...before,
    "isbf_v2.feedback_unavailable",
  ]);
  await actions.openJoin();
  assert.deepEqual(calls.splice(0), [...before, Component]);
}

for (const method of ["openSettings", "openFeedback", "openJoin"]) {
  let finishClosing;
  const actions = new UtilityActions({
    menu: {
      close: () =>
        new Promise((resolve) => {
          finishClosing = resolve;
        }),
    },
  });
  actions.router = { transitionTo: (path) => calls.push(path) };
  actions.modal = { show: (component) => calls.push(component) };
  actions.site = site;
  const pending = actions[method]();
  await Promise.resolve();
  assert.equal(calls.length, 0, `${method} waits for the desktop menu`);
  finishClosing();
  await pending;
  assert.equal(calls.length, 1);
  calls.splice(0);
}

const desktopMenuSource = read("components/isbf-v2-more-menu.gjs");
assert.match(desktopMenuSource, /<DMenu\s/);
assert.match(desktopMenuSource, /<ISBFV2UtilityActions @menu=\{\{menu\}\} \/>/);
assert.match(desktopMenuSource, /@placement="top-start"/);
const workbenchSource = read("components/isbf-v2-workbench.gjs");
assert.match(workbenchSource, /<\/section>\s*<ISBFV2UtilityActions \/>/);
for (const page of ["isbf-learning.gjs", "isbf-alumni.gjs"]) {
  assert.doesNotMatch(read(`components/${page}`), /ISBFV2UtilityActions/);
}
const styles = readFileSync(
  new URL("../common/common.scss", import.meta.url),
  "utf8",
);
assert.match(styles, /\.isbf-v2-workbench__actions\s*\{\s*display: none;/);
const mobileStyles = styles.slice(
  styles.indexOf(
    "@media (width <= 600px)",
    styles.indexOf(".isbf-v2-workbench__name"),
  ),
);
assert.match(
  mobileStyles,
  /\.isbf-v2-workbench\s*\{\s*display: flex;\s*flex-direction: column;\s*min-height: 100dvh;/,
);
assert.match(
  mobileStyles,
  /padding-bottom: calc\(\s*64px \+ var\(--isbf-v2-space-4\) \+ env\(safe-area-inset-bottom\)\s*\);/,
);
const footerStyles = mobileStyles.match(
  /\.isbf-v2-workbench__actions\s*\{([^}]+)\}/,
)[1];
assert.match(
  footerStyles,
  /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
);
assert.match(footerStyles, /margin-top: auto;/);
assert.match(footerStyles, /padding-top: var\(--isbf-v2-space-6\);/);
assert.doesNotMatch(footerStyles, /position: (?:fixed|absolute|sticky)/);
const actionStyles = mobileStyles.match(
  /\.isbf-v2-workbench__action\s*\{([\s\S]+?)\n  \}/,
)[1];
assert.match(actionStyles, /min-height: 44px;/);
assert.match(actionStyles, /min-width: 0;/);
assert.match(actionStyles, /width: 24px;\s*height: 24px;/);
assert.match(actionStyles, /font-size: var\(--isbf-v2-font-sm\);/);
assert.match(actionStyles, /&:hover,\s*&:focus-visible/);
for (const width of [390, 430]) {
  const cellWidth = (width - 2 * 16 - 2 * 8) / 3;
  const largestItem = 24 + 8 + 4 * 15 + 2 * 8;
  assert.ok(cellWidth >= largestItem, `${width}px fits icon and longest label`);
}

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
