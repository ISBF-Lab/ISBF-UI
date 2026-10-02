import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const componentPaths = [
  "javascripts/discourse/components/isbf-explore.gjs",
  "javascripts/discourse/components/isbf-explore-group.gjs",
  "javascripts/discourse/components/isbf-explore-picker.gjs",
];
const keys = new Set();
for (const path of componentPaths) {
  const source = readFileSync(new URL(path, root), "utf8");
  const stack = [];
  for (const match of source.matchAll(
    /\{\{([#/])(if|unless|each|let)(?:\s[^}]*)?\}\}/g
  )) {
    if (match[1] === "#") {
      stack.push(match[2]);
    } else {
      assert.equal(stack.pop(), match[2], `${path}: balanced template blocks`);
    }
  }
  assert.equal(stack.length, 0, `${path}: closed template blocks`);
  new vm.SourceTextModule(
    source
      .replace(/<template>[\s\S]*?<\/template>/g, "")
      .replace(/@(service|tracked|action)\s+/g, ""),
    { identifier: path }
  );
  for (const match of source.matchAll(/"isbf_v2\.(explore_[a-z_]+)"/g)) {
    keys.add(match[1]);
  }
}
for (const locale of ["en", "zh_CN"]) {
  const source = readFileSync(new URL(`locales/${locale}.yml`, root), "utf8");
  for (const key of keys) {
    assert.match(source, new RegExp(`^    ${key}:`, "m"), `${locale}: ${key}`);
  }
}
const about = JSON.parse(readFileSync(new URL("about.json", root), "utf8"));
assert.ok(about.modifiers.svg_icons.includes("chevron-down"));

async function loadHelper(name, globals = {}) {
  const module = new vm.SourceTextModule(
    readFileSync(
      new URL(`javascripts/discourse/lib/explore-${name}.js`, root),
      "utf8"
    ),
    { context: vm.createContext({ clearTimeout, setTimeout, ...globals }) }
  );
  await module.link(() => {
    throw new Error("Explore helpers must not import application services");
  });
  await module.evaluate();
  return module.namespace;
}

const query = await loadHelper("query");
const categories = [
  { id: 1, name: "Default", slug: "" },
  { id: 2, name: "Campus", slug: "campus" },
  { id: 3, name: "Events", parent_category_id: 2 },
];
assert.equal(query.categoryFilterId(categories[0]), 1);
assert.equal(query.categoryFilterId(categories[2]), 3);
assert.equal(query.categoryFilterId({ id: "4", slug: "general" }), 4);
for (const id of [undefined, null, 0, -1, 1.5, "general", 2147483648]) {
  assert.equal(query.categoryFilterId({ id }), null);
  if (id !== undefined) {
    assert.throws(() => query.buildExploreQuery({ categoryId: id }));
  }
}
assert.equal(
  query.buildExploreQuery({
    categoryId: 3,
    tags: ["scholarship", "deadline", "scholarship"],
    order: "activity",
  }),
  "isbf-category:3 tag:scholarship,deadline order:activity"
);
assert.equal(
  query.buildExploreQuery({ categoryId: 4, order: "hot" }),
  "isbf-category:4 order:hot"
);
assert.equal(query.buildExploreQuery({}), "order:activity");

const componentContext = vm.createContext({ clearTimeout, setTimeout });
const componentHelpers = new Map();
for (const name of ["preferences", "query"]) {
  const helper = new vm.SourceTextModule(
    readFileSync(
      new URL(`javascripts/discourse/lib/explore-${name}.js`, root),
      "utf8"
    ),
    { context: componentContext }
  );
  await helper.link(() => {
    throw new Error("Unexpected helper dependency");
  });
  componentHelpers.set(`../lib/explore-${name}`, helper);
}
const exploreComponent = new vm.SourceTextModule(
  readFileSync(new URL(componentPaths[0], root), "utf8")
    .replace(/<template>[\s\S]*?<\/template>/g, "")
    .replace(/@(service|tracked|action)\s+/g, ""),
  { context: componentContext }
);
await exploreComponent.link((specifier) => {
  if (componentHelpers.has(specifier)) {
    return componentHelpers.get(specifier);
  }
  const exports = {
    default:
      specifier === "@glimmer/component"
        ? class {
            willDestroy() {}
          }
        : () => {},
    action: () => {},
    ajax: () => {
      throw new Error("Unexpected request");
    },
    i18n: (key) => key,
    service: () => {},
    themePrefix: (key) => key,
    tracked: () => {},
  };
  return new vm.SyntheticModule(
    Object.keys(exports),
    function () {
      for (const [name, value] of Object.entries(exports)) {
        this.setExport(name, value);
      }
    },
    { context: componentContext }
  );
});
await exploreComponent.evaluate();
const explore = new exploreComponent.namespace.default();
explore.site = { categories };
explore.preferences = { category_ids: [1, 3], tag_ids: [], order: "activity" };
assert.equal(
  explore.groups.length,
  0,
  "Missing plugin capability blocks queries"
);
explore.site.isbf_explore_category_id_filter = true;
assert.deepEqual(
  Array.from(explore.groups, (group) => group.query),
  ["isbf-category:1 order:activity", "isbf-category:3 order:activity"],
  "Empty and absent slugs do not prevent independent category groups"
);
explore.site.isbf_explore_category_id_filter = false;
assert.equal(
  explore.groups.length,
  0,
  "Disabled plugin blocks restored groups"
);
explore.willDestroy();

assert.deepEqual(
  Array.from(
    query.uniqueTopicList([{ id: 1 }, { id: 2 }, { id: 1 }]),
    (t) => t.id
  ),
  [1, 2]
);

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const gates = [];
let active = 0;
let peak = 0;
let cancelledRan = false;
const jobs = Array.from({ length: 5 }, (_, index) =>
  query.enqueueExploreQuery(
    () => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise((resolve) => {
        gates.push(() => {
          active -= 1;
          resolve(index);
        });
      });
    },
    () => true
  )
);
jobs.push(
  query.enqueueExploreQuery(
    () => {
      cancelledRan = true;
    },
    () => false
  )
);
await tick();
assert.equal(gates.length, 2);
while (gates.length) {
  gates.shift()();
  await tick();
}
await Promise.all(jobs);
assert.equal(peak, 2, "Filter and pagination share a two-request limit");
assert.equal(cancelledRan, false, "Stale queued groups do not issue requests");

const header = { getBoundingClientRect: () => ({ height: 48 }) };
const footer = { getBoundingClientRect: () => ({ height: 60 }) };
const topNav = {
  getBoundingClientRect: () => ({ top: 0, bottom: 64, width: 390, height: 64 }),
  matches: () => false,
};
const bottomNav = {
  getBoundingClientRect: () => ({
    top: 736,
    bottom: 800,
    width: 390,
    height: 64,
  }),
  matches: () => true,
};
const visibleChrome = [topNav, bottomNav];
const preview = await loadHelper("preview", {
  document: { querySelectorAll: () => visibleChrome },
  window: {
    getComputedStyle: () => ({ position: "fixed" }),
    innerHeight: 900,
    visualViewport: { height: 800, offsetTop: 0 },
  },
});
assert.equal(
  preview.explorePreviewBudget({
    querySelector: (selector) =>
      selector.includes("header") ? header : footer,
  }),
  564,
  "Actual visual viewport, navigation, heading, and footer reduce the budget"
);
visibleChrome.push({
  getBoundingClientRect: () => ({
    top: 32,
    bottom: 96,
    width: 390,
    height: 64,
  }),
});
assert.equal(
  preview.explorePreviewBudget({
    querySelector: (selector) =>
      selector.includes("header") ? header : footer,
  }),
  532,
  "Visible static toolbar counts once where it overlaps fixed navigation"
);
for (const [heights, budget, count, complete] of [
  [[210, 140, 60], 360, 2, true],
  [[900, 20], 80, 1, true],
  [[null], 400, 0, false],
  [[90, null], 100, 1, false],
  [[90, 80, null], 100, 1, true],
  [[90, 80], 180, 2, true],
  [[140, 80], 180, 1, true],
]) {
  const result = preview.previewForHeights(heights, budget);
  assert.equal(result.count, count);
  assert.equal(result.complete, complete);
}

const preferences = await loadHelper("preferences");
assert.equal(preferences.normalizeExplorePreferences().order, "activity");
const calls = [];
const saves = [];
const states = [];
let activeSaves = 0;
let peakSaves = 0;
const writer = preferences.createExplorePreferenceWriter({
  delay: 0,
  onSaved: (snapshot) => saves.push(snapshot),
  onState: (state) => states.push(state),
  save: (snapshot) => {
    activeSaves += 1;
    peakSaves = Math.max(peakSaves, activeSaves);
    return new Promise((resolve) => {
      calls.push({
        snapshot,
        resolve: () => {
          activeSaves -= 1;
          resolve({ preferences: snapshot, tags: [] });
        },
      });
    });
  },
});
writer.update({ category_ids: [1] });
writer.update({ category_ids: [2] });
await tick();
assert.equal(calls.length, 1, "Rapid changes coalesce");
assert.deepEqual(Array.from(calls[0].snapshot.category_ids), [2]);
writer.update({ category_ids: [3] });
writer.update({ category_ids: [4] });
await tick();
assert.equal(calls.length, 1, "PUT requests stay serialized");
calls[0].resolve();
await tick();
assert.equal(calls.length, 2);
assert.deepEqual(Array.from(calls[1].snapshot.category_ids), [4]);
calls[1].resolve();
await tick();
assert.equal(peakSaves, 1);
assert.equal(states.at(-1), "saved");
assert.equal(saves.length, 2);
writer.cancel();

let attempts = 0;
let lastState;
let retrySnapshot;
const failingWriter = preferences.createExplorePreferenceWriter({
  delay: 0,
  onState: (state) => (lastState = state),
  save: async (snapshot) => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("offline");
    }
    retrySnapshot = snapshot;
    return {};
  },
});
failingWriter.update({ tag_ids: [7] });
await tick();
assert.equal(lastState, "failed");
failingWriter.update({ tag_ids: [7, 8] });
await tick();
assert.equal(attempts, 1, "Failed writes preserve pending state until retry");
await failingWriter.retry();
assert.equal(attempts, 2);
assert.equal(lastState, "saved");
assert.deepEqual(Array.from(retrySnapshot.tag_ids), [7, 8]);
failingWriter.cancel();

let finish;
const afterCancel = [];
const cancelledWriter = preferences.createExplorePreferenceWriter({
  delay: 0,
  onState: (state) => afterCancel.push(state),
  save: () => new Promise((resolve) => (finish = resolve)),
});
cancelledWriter.update({ category_ids: [1] });
await tick();
cancelledWriter.update({ category_ids: [2] });
cancelledWriter.cancel();
const callbacksBeforeCancel = afterCancel.length;
finish({});
await tick();
assert.equal(
  afterCancel.length,
  callbacksBeforeCancel,
  "Account cancellation is silent"
);

console.log(
  "Explore syntax/locales, exact category and OR-tag queries, request limits, measured previews, and serialized preference recovery OK"
);
