import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n"
  );
function component(path) {
  const text = source(path);
  const initialization = text.match(/^let nextListId = \d+;$/m)?.[0] ?? "";
  const declaration = text.slice(
    text.indexOf("export default class"),
    text.indexOf("  <template>")
  );
  assert.ok(declaration, `${path} exposes component behavior`);
  const name = declaration.match(/export default class (\w+)/)?.[1];
  assert.ok(name);
  const body = declaration
    .replace("export default ", "")
    .replace(/^\s*@(tracked|action)\s*/gm, "");
  return vm.runInNewContext(`${initialization}\n${body}}\n${name}`, {
    Component: class {
      constructor(args) {
        this.args = args;
      }
    },
    themePrefix: (key) => key,
  });
}

const sectionPath =
  "javascripts/discourse/components/isbf-profile-summary-section.gjs";
const Section = component(sectionPath);
for (const length of [0, 1, 3, 4, 6, 20]) {
  const items = Object.freeze(
    Array.from({ length }, (_, id) => Object.freeze({ id }))
  );
  const instance = new Section({ items, moreRoute: "userActivity.replies" });
  const before = JSON.stringify(items);
  assert.equal(instance.expanded, false);
  assert.equal(instance.canExpand, length > 3);
  assert.equal(instance.visibleItems.length, Math.min(length, 3));
  assert.equal(
    instance.showActivityLink,
    length >= 6,
    "Native more links use full source length"
  );
  assert.match(instance.toggleLabel, /summary_expand$/);
  instance.visibleItems.forEach((item, index) =>
    assert.equal(item, items[index])
  );
  instance.toggle();
  assert.equal(instance.expanded, true);
  assert.equal(instance.visibleItems.length, length);
  instance.visibleItems.forEach((item, index) =>
    assert.equal(item, items[index])
  );
  assert.match(instance.toggleLabel, /summary_collapse$/);
  instance.toggle();
  assert.equal(instance.visibleItems.length, Math.min(length, 3));
  assert.equal(
    JSON.stringify(items),
    before,
    "Displaying or toggling must not mutate native data"
  );
}
for (const items of [undefined, null]) {
  const instance = new Section({ items });
  assert.equal(instance.items.length, 0);
  assert.equal(instance.visibleItems.length, 0);
  assert.equal(instance.canExpand, false);
  assert.equal(instance.showActivityLink, false);
}
const items = Array.from({ length: 8 }, (_, id) => ({ id }));
const first = new Section({ items });
const second = new Section({ items });
first.toggle();
assert.equal(first.visibleItems.length, 8);
assert.equal(second.visibleItems.length, 3, "Sections expand independently");
assert.notEqual(
  first.listId,
  second.listId,
  "Disclosure controls need distinct list targets"
);
assert.equal(
  first.showActivityLink,
  false,
  "User sections must not invent an activity link"
);
const remounted = new Section({ items });
assert.equal(
  new Set([first.listId, second.listId, remounted.listId]).size,
  3,
  "Remounting must not reuse an existing disclosure target"
);
assert.equal(
  remounted.expanded,
  false,
  "A newly mounted profile starts collapsed"
);

const profilePath = "javascripts/discourse/components/isbf-profile-summary.gjs";
const Profile = component(profilePath);
const user = { id: 42, username: "sample" };
const summary = { replies: items };
const profile = new Profile({ outletArgs: { user, model: summary } });
assert.equal(profile.user, user);
assert.equal(profile.summary, summary);
assert.equal(profile.profiles.length, 1);
assert.equal(profile.profiles[0], user);
for (const args of [
  {},
  { outletArgs: {} },
  { outletArgs: { user } },
  { outletArgs: { model: summary } },
]) {
  assert.equal(
    new Profile(args).profiles.length,
    0,
    "Loading or missing profiles render no rows"
  );
}
const template = source(profilePath).split("<template>")[1];
assert.match(
  template,
  /#each this\.profiles key="id"/,
  "User changes remount disclosures and reset expansion"
);
const fields = [
  ...template.matchAll(/@items=\{\{this\.summary\.(\w+)\}\}/g),
].map((match) => match[1]);
assert.deepEqual(fields, [
  "replies",
  "topics",
  "most_replied_to_users",
  "most_liked_by_users",
  "most_liked_users",
]);
assert.match(template, /UserSummaryTopic/);
assert.match(template, /UserSummaryUser/);
assert.doesNotMatch(
  template,
  /links|ajax|fetch\(/,
  "Summary uses existing native data without popular links or new requests"
);
const sectionTemplate = source(sectionPath).split("<template>")[1];
assert.match(sectionTemplate, /aria-expanded=\{\{this\.expanded\}\}/);
assert.match(sectionTemplate, /aria-controls=\{\{this\.listId\}\}/);
assert.match(sectionTemplate, /UserSummarySection/);
assert.match(sectionTemplate, /LinkTo/);
assert.match(sectionTemplate, /DButton/);
const initializer = source(
  "javascripts/discourse/api-initializers/isbf-profile-summary.gjs"
);
assert.match(initializer, /below-user-summary-stats/);
assert.match(initializer, /ISBFProfileSummary/);

process.stdout.write(
  "Profile summary checks passed: three-row disclosure, native data, independent state, and user reset.\n"
);
