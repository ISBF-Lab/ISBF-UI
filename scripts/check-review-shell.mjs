import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
class Component {}
const dependencies = {
  default: Component,
  action() {},
  service() {},
  on() {},
  getOwner() {},
  settings: { official_path: "/c/official/6", show_right_rail: true },
  themePrefix: (key) => key,
  i18n: (key) => key,
  feedbackCategory: () => null,
  feedbackComposeHref: () => "/new-topic",
  isFeedbackPath: () => false,
  notificationsEnabled: () => false,
  officialConfig: () => null,
  isFeedStyleTopic: () => false,
};
async function load(path) {
  const content = read(path)
    .replace(/<template>[\s\S]*?<\/template>/g, "")
    .replace(/@service\s+\w+;\s*/g, "")
    .replace(/@action\s+/g, "");
  const module = new vm.SourceTextModule(content);
  await module.link(
    () =>
      new vm.SyntheticModule(Object.keys(dependencies), function () {
        for (const [name, value] of Object.entries(dependencies)) {
          this.setExport(name, value);
        }
      })
  );
  await module.evaluate();
  return module.namespace.default;
}
const Shell = await load("javascripts/discourse/components/isbf-v2-shell.gjs");
const SideNav = await load(
  "javascripts/discourse/components/isbf-v2-side-nav.gjs"
);
const shell = new Shell();
const navigation = new SideNav();
const queue = { canReview: true, hasPending: false };
const router = { currentURL: "/review" };
shell.router = navigation.router = router;
shell.isbfReviewQueue = navigation.isbfReviewQueue = queue;
shell.currentUser = navigation.currentUser = { staff: true, can_review: true };
shell.site = navigation.site = {};
shell.siteSettings = {};
for (const route of [
  "/review",
  "/review?status=pending&type=ReviewableIsbfAlumni",
  "/review/42",
  "/review/topics",
  "/review/settings",
]) {
  router.currentURL = route;
  assert.equal(shell.pageKind, "review", route);
  assert.equal(shell.isReview, true);
  assert.equal(shell.showRightRail, false);
  assert.equal(shell.showPageHeader, true);
  assert.equal(shell.pageTitle, "review.title");
  assert.equal(navigation.reviewActive, true);
  assert.equal(
    shell.showMobileReview,
    false,
    "No duplicate floating entry inside the queue"
  );
}
for (const route of [
  "/admin",
  "/admin/site_settings",
  "/login",
  "/signup",
  "/reviewing",
]) {
  router.currentURL = route;
  assert.equal(shell.pageKind, null, route);
  assert.equal(navigation.reviewActive, false);
}
for (const canReview of [true, false]) {
  queue.canReview = canReview;
  router.currentURL = "/review";
  assert.equal(shell.pageKind, canReview ? "review" : null);
  router.currentURL = "/latest";
  assert.equal(shell.pageKind, "feed");
  assert.equal(shell.showMobileReview, canReview);
}
const navSource = read("javascripts/discourse/components/isbf-v2-side-nav.gjs");
const shellSource = read("javascripts/discourse/components/isbf-v2-shell.gjs");
assert.match(navSource, /\{\{#if this\.isbfReviewQueue\.canReview\}\}/);
assert.doesNotMatch(navSource, /\{\{#if this\.currentUser\.staff\}\}/);
for (const content of [navSource, shellSource]) {
  assert.match(content, /this\.isbfReviewQueue\.hasPending/);
  assert.match(content, /has-pending/);
  assert.match(content, /isbf_v2\.review_pending/);
  assert.match(content, /href="\/review"/);
}
assert.match(read("common/common.scss"), /body:has\(\.isbf-v2-shell--review\)/);
for (const locale of ["en", "zh_CN"]) {
  assert.match(read(`locales/${locale}.yml`), /review_pending:/);
}
process.stdout.write(
  "Review shell route, permission, native content boundary and shared alert checks passed.\n"
);
