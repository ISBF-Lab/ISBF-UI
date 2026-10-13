import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  feedbackCategory,
  isFeedbackPath,
} from "../javascripts/discourse/lib/feedback-category.js";

const source = readFileSync(
  new URL(
    "../javascripts/discourse/components/isbf-v2-shell.gjs",
    import.meta.url,
  ),
  "utf8",
);
const classSource =
  source
    .slice(
      source.indexOf("export default class"),
      source.indexOf("  <template>"),
    )
    .replace("export default ", "")
    .replace(/^\s*@service \w+;/gm, "")
    .replace(/^\s*@action\s*$/gm, "") + "\n}";
const settings = { official_path: "/c/official/6", feedback_category_id: 5 };
const Shell = vm.runInNewContext("(" + classSource + ")", {
  Component: class {},
  feedbackCategory,
  isFeedbackPath,
  settings,
  officialConfig: (site) => site.isbf_official ?? null,
});
const official = { id: 6, canCreateTopic: true };
function fixture({
  user = { academy_official_member: true },
  path = "/c/official/6",
  category = official,
} = {}) {
  const shell = new Shell();
  const calls = [];
  const result = Promise.resolve();
  Object.assign(shell, {
    currentUser: user,
    router: { currentURL: path },
    site: { categories: category ? [category] : [] },
    composer: {
      openNewTopic: (options) => {
        calls.push(options);
        return result;
      },
    },
  });
  return { shell, calls, result };
}
function click(overrides = {}) {
  return {
    button: 0,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...overrides,
  };
}
const native = fixture();
const event = click();
assert.equal(native.shell.openComposer(event), native.result);
assert.equal(event.prevented, true);
assert.deepEqual(native.calls[0].category, official);
assert.equal(native.calls.length, 1);
assert.equal(native.shell.router.currentURL, "/c/official/6");
const member = fixture({ user: { academy_official_member: false } });
const forbidden = click();
member.shell.openComposer(forbidden);
assert.equal(forbidden.prevented, true);
assert.equal(member.calls.length, 0);
for (const attrs of [{ user: null }, { path: "/latest" }]) {
  const original = fixture(attrs);
  const ordinary = click();
  original.shell.openComposer(ordinary);
  assert.equal(ordinary.prevented, false);
  assert.equal(original.calls.length, 0);
}
for (const overrides of [
  { ctrlKey: true },
  { metaKey: true },
  { shiftKey: true },
  { altKey: true },
  { button: 1 },
  { defaultPrevented: true },
]) {
  const original = fixture();
  const modified = click(overrides);
  original.shell.openComposer(modified);
  assert.equal(modified.prevented, false);
  assert.equal(original.calls.length, 0);
}
for (const category of [null, { ...official, canCreateTopic: false }]) {
  const original = fixture({ category });
  original.shell.openComposer(click());
  assert.equal(original.calls.length, 0);
}
const template = source.slice(source.indexOf("  <template>"));
assert.equal(
  (template.match(/\{\{on "click" this\.openComposer\}\}/g) ?? []).length,
  3,
);
assert.equal(
  (template.match(/href=\{\{this\.composeHref\}\}/g) ?? []).length,
  3,
);
assert.match(source, /@service composer;/);
process.stdout.write(
  "Official feed publish opens native Composer in place; permission, guest, other feeds and modified links preserved.\n",
);
