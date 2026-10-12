import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const teamup = read("javascripts/discourse/components/isbf-teamup.gjs");
const pageShell = read(
  "javascripts/discourse/components/isbf-workbench-topic-page.gjs",
);
const marketplace = read(
  "javascripts/discourse/components/isbf-marketplace.gjs",
);
const helper = new vm.SourceTextModule(
  read("javascripts/discourse/lib/teamup.js"),
);
await helper.link(() => {});
await helper.evaluate();
const { teamupConfig, teamupQuery } = helper.namespace;

function componentClass(source, name, globals = {}) {
  const body =
    source
      .slice(
        source.indexOf("export default class"),
        source.indexOf("  <template>"),
      )
      .replace("export default ", "")
      .replace(/^\s*@service \w+;\s*$/gm, "")
      .replace(/^\s*@(tracked|action)\s*/gm, "") + "}";
  return vm.runInNewContext(`${body}\n${name}`, {
    Component: class {
      willDestroy() {}
    },
    scheduleOnce() {},
    ...globals,
  });
}

const events = [];
const removed = [];
const Page = componentClass(teamup, "ISBFTeamup", {
  teamupConfig,
  teamupQuery,
  Composer: { CREATE_TOPIC: "createTopic", NEW_TOPIC_KEY: "new_topic" },
});
Page.prototype.appEvents = {
  on: (...args) => events.push(args),
  off: (...args) => removed.push(args),
  trigger() {},
};
const page = new Page();
const config = { version: 1, category_id: 42 };
page.site = {
  isbf_teamup: config,
  categories: [{ id: 42, canCreateTopic: true }],
};
page.currentUser = { id: 1 };
const opened = [];
page.composer = { open: (args) => opened.push(args) };
assert.equal(page.canCreate, true);
page.create();
assert.deepEqual(JSON.parse(JSON.stringify(opened[0])), {
  action: "createTopic",
  categoryId: 42,
  draftKey: "new_topic",
});
for (const deny of [
  () => (config.publishing_enabled = false),
  () => {
    delete config.publishing_enabled;
    page.site.categories[0].canCreateTopic = false;
  },
  () => {
    page.site.categories[0].canCreateTopic = true;
    page.currentUser = null;
  },
  () => {
    page.currentUser = { id: 1 };
    page.site.isbf_teamup = null;
  },
]) {
  deny();
  assert.equal(page.canCreate, false);
  page.create();
}
assert.equal(opened.length, 1);
page.site.isbf_teamup = config;

let queries = 0;
let failMore = true;
const list = {
  topics: [{ id: 1 }],
  canLoadMore: true,
  set(key, value) {
    this[key] = value;
  },
  async loadMore() {
    if (failMore) {
      throw new Error("pagination network failure");
    }
    this.topics.push({ id: 2 });
    this.canLoadMore = false;
  },
};
page.store = {
  async findFiltered(type, options) {
    queries++;
    assert.equal(type, "topicList");
    assert.equal(options.filter, "filter");
    assert.equal(options.params.q, "isbf-teamup:all order:created");
    return list;
  },
};
page.currentUser = null;
await page.load();
assert.equal(queries, 0);
page.currentUser = { id: 1 };
page.site.isbf_teamup = null;
await page.load();
assert.equal(queries, 0);
page.site.isbf_teamup = config;
await page.load();
assert.equal(page.topics.length, 1);
await page.loadMore();
assert.equal(page.error, true);
assert.equal(list.loadingMore, false);
failMore = false;
await page.retry();
assert.equal(page.error, false);
assert.equal(page.topics.length, 2);

let release;
page.store.findFiltered = () => {
  queries++;
  return queries === 2
    ? new Promise((resolve) => (release = resolve))
    : Promise.resolve(list);
};
const loading = page.load();
await page.load();
page.refresh();
page.refresh();
assert.equal(
  queries,
  2,
  "In-flight refreshes and loads must not duplicate requests",
);
release(list);
await loading;
await Promise.resolve();
assert.equal(
  queries,
  3,
  "Composer refreshes during loading must coalesce and reload",
);

let failRefresh = true;
page.store.findFiltered = async () => {
  queries++;
  if (failRefresh) {
    throw new Error("refresh network failure");
  }
  return list;
};
await page.refresh();
assert.equal(page.error, true);
failRefresh = false;
await page.retry();
assert.equal(page.error, false);
assert.equal(
  queries,
  5,
  "Retrying failed refresh must reload, not paginate an old list",
);

assert.deepEqual(
  events.map(([event]) => event),
  ["composer:created-post", "composer:edited-post"],
);
for (const [, callback] of events) {
  await callback.call(page);
}
assert.equal(queries, 7, "Both native composer events must refresh the page");
let releaseMore;
list.canLoadMore = true;
list.loadMore = () => new Promise((resolve) => (releaseMore = resolve));
const more = page.loadMore();
page.refresh();
assert.equal(queries, 7);
releaseMore();
await more;
await Promise.resolve();
assert.equal(
  queries,
  8,
  "Composer refresh during pagination must reload after it completes",
);
page.willDestroy();
assert.equal(removed.length, 2);
for (let index = 0; index < 2; index++) {
  assert.equal(removed[index][0], events[index][0]);
  assert.equal(removed[index][1], events[index][1]);
}

const dying = new Page();
dying.site = page.site;
dying.currentUser = page.currentUser;
let resolveDying;
dying.store = {
  findFiltered: () => new Promise((resolve) => (resolveDying = resolve)),
};
const dyingRequest = dying.load();
dying.isDestroying = true;
resolveDying(list);
await dyingRequest;
assert.equal(dying.topicList, null);
assert.equal(dying.topics.length, 0);
await dying.load();

const Shell = componentClass(pageShell, "ISBFWorkbenchTopicPage", {
  themePrefix: (key) => key,
  i18n: (key) => key,
});
const shell = new Shell();
for (const kind of ["marketplace", "teamup"]) {
  shell.args = { kind };
  assert.equal(shell.title, `isbf_v2.workbench_${kind}`);
  assert.equal(shell.labels.publish, `isbf_v2.${kind}_publish`);
  assert.equal(shell.labels.login, `isbf_v2.${kind}_login`);
}
assert.match(pageShell, /class="isbf-workbench-topic-page"/);
assert.match(pageShell, /{{yield}}/);
assert.match(teamup, /<ISBFV2FeedCard\s/);
assert.doesNotMatch(teamup, /ISBFMarketplaceCard/);
assert.match(teamup, /<ISBFWorkbenchTopicPage\s+class="isbf-teamup"/);
assert.match(marketplace, /<ISBFWorkbenchTopicPage\s+class="isbf-marketplace"/);
assert.match(marketplace, /<ISBFMarketplaceCard\s/);
console.log("Workbench topic page VM checks passed");
