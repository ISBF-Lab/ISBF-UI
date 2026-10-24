import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const componentPath =
  "javascripts/discourse/components/isbf-alumni-review-nav.gjs";
const content = read(componentPath);
class Component {}
const dependencies = {
  "@glimmer/component": { default: Component },
  "@ember/service": { service() {} },
  "virtual:theme": { themePrefix: (key) => key },
  "discourse-i18n": { i18n: (key) => key },
};
const module = new vm.SourceTextModule(
  content
    .replace(/<template>[\s\S]*?<\/template>/, "")
    .replace(/@service\s+\w+;\s*/g, ""),
  { context: vm.createContext({ URL }) }
);
await module.link((name) => {
  const values = dependencies[name];
  assert.ok(values, `Unexpected component dependency: ${name}`);
  return new vm.SyntheticModule(
    Object.keys(values),
    function () {
      for (const [key, value] of Object.entries(values)) {
        this.setExport(key, value);
      }
    },
    { context: module.context }
  );
});
await module.evaluate();
const nav = new module.namespace.default();
nav.router = { currentURL: "/review" };

for (const [user, expected] of [
  [null, false],
  [{}, false],
  [{ can_review: true }, false],
  [{ can_review: true, staff: true }, false],
  [{ can_review: true, admin: true }, true],
  [{ can_review: false, admin: true }, false],
  [
    {
      can_review: true,
      academy_moderator_permissions: { review_alumni: true },
    },
    true,
  ],
  [
    {
      can_review: true,
      academy_moderator_permissions: { review_alumni: false },
    },
    false,
  ],
  [
    {
      can_review: true,
      academy_moderator_permissions: { review_resources: true },
    },
    false,
  ],
]) {
  nav.currentUser = user;
  assert.equal(nav.visible, expected, JSON.stringify(user));
}
nav.currentUser = {
  can_review: true,
  academy_moderator_permissions: { review_alumni: false },
};
assert.equal(nav.visible, false);
nav.currentUser.academy_moderator_permissions.review_alumni = true;
assert.equal(
  nav.visible,
  true,
  "Permission changes are read from the current user"
);
nav.currentUser.reviewable_count = 0;
assert.equal(
  nav.visible,
  true,
  "The entry remains available with no pending items"
);
for (const path of [
  "/review",
  "/review/",
  "/review/12",
  "/review/topics",
  "/review/settings",
  "/review?status=approved",
]) {
  nav.router.currentURL = path;
  assert.equal(nav.visible, true, path);
}
for (const path of [
  "/",
  "/latest",
  "/reviewing",
  "/review-alumni",
  "/admin/review",
  "/login",
]) {
  nav.router.currentURL = path;
  assert.equal(nav.visible, false, path);
}
for (const [path, all, alumni] of [
  ["/review", "page", undefined],
  ["/review?status=approved&type=", "page", undefined],
  ["/review?type=ReviewableIsbfAlumni", undefined, "page"],
  ["/review?type=ReviewableFlaggedPost", undefined, undefined],
  ["/review/12?type=ReviewableIsbfAlumni", undefined, undefined],
  ["/review/topics", undefined, undefined],
]) {
  nav.router.currentURL = path;
  assert.equal(nav.allCurrent, all, path);
  assert.equal(nav.alumniCurrent, alumni, path);
}
const allUrl = new URL(nav.allHref, "https://isbf.invalid");
assert.equal(allUrl.pathname, "/review");
assert.equal(allUrl.searchParams.get("status"), "pending");
assert.equal(
  allUrl.searchParams.has("type"),
  true,
  "Explicitly clear the native sticky type"
);
assert.equal(allUrl.searchParams.get("type"), "");
const alumniUrl = new URL(nav.alumniHref, "https://isbf.invalid");
assert.equal(alumniUrl.searchParams.get("type"), "ReviewableIsbfAlumni");
assert.equal(alumniUrl.searchParams.get("status"), "pending");
assert.match(content, /<nav[\s\S]*?aria-label=/);
assert.match(
  content,
  /<a aria-current=\{\{this\.allCurrent\}\} href=\{\{this\.allHref\}\}/
);
assert.match(
  content,
  /<a aria-current=\{\{this\.alumniCurrent\}\} href=\{\{this\.alumniHref\}\}/
);

const initializer = new vm.SourceTextModule(
  read("javascripts/discourse/api-initializers/isbf-alumni-review-nav.js")
);
const initializerDependencies = {
  "discourse/lib/api": { apiInitializer: (callback) => callback },
  "../components/isbf-alumni-review-nav": { default: module.namespace.default },
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
let registrations = 0;
initializer.namespace.default({
  renderInOutlet(outlet, klass) {
    assert.equal(outlet, "top-notices");
    assert.equal(klass, module.namespace.default);
    registrations++;
  },
});
assert.equal(registrations, 1);
process.stdout.write(
  "Alumni review navigation permission, routes and outlet checks passed.\n"
);
