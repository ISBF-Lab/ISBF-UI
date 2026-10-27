import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const context = vm.createContext({});
const synthetic = (values) =>
  new vm.SyntheticModule(
    Object.keys(values),
    function () {
      for (const [key, value] of Object.entries(values)) {
        this.setExport(key, value);
      }
    },
    { context }
  );
const scope = new vm.SourceTextModule(
  read("javascripts/discourse/lib/topic-card-scope.js"),
  { context }
);
await scope.link(() => {});
await scope.evaluate();
const official = new vm.SourceTextModule(
  read("javascripts/discourse/lib/official-topic-scope.js"),
  { context }
);
await official.link(() => scope);
await official.evaluate();
const { isOfficialCalendarPost } = official.namespace;
const post = {
  id: 15,
  post_number: 1,
  post_type: 1,
  topic: { id: 8, category_id: 6, archetype: "regular", title: "Campus" },
};
const site = { isbf_official: { category_id: 6 } };
assert.equal(isOfficialCalendarPost(post, site, "/t/campus/8"), true);
assert.equal(
  isOfficialCalendarPost(
    post,
    { isbf_calendar: { official_category_id: 6 } },
    "/t/campus/8"
  ),
  true
);
for (const candidate of [
  { post: { ...post, post_number: 2 } },
  { post: { ...post, post_type: 2 } },
  { post: { ...post, topic: { ...post.topic, category_id: 4 } } },
  { post: { ...post, topic: { ...post.topic, archetype: "private_message" } } },
  { post: { ...post, topic: { ...post.topic, is_nested_view: true } } },
  { site: {} },
  { site: { isbf_official: { category_id: 0 } } },
  { path: "/latest" },
  { path: "/admin" },
  { nested: true },
]) {
  assert.equal(
    isOfficialCalendarPost(
      candidate.post ?? post,
      candidate.site ?? site,
      candidate.path ?? "/t/campus/8",
      candidate.nested
    ),
    false
  );
}
assert.equal(isOfficialCalendarPost(undefined, site, "/t/campus/8"), false);
const event = {
  id: 1,
  revision: 2,
  title: "Campus",
  schedule_kind: "event",
  starts_at: "2026-10-14T00:00:00Z",
  ends_at: "2026-10-14T01:00:00Z",
};
const deadline = { ...event, id: 2, schedule_kind: "deadline" };
const user = { id: 5 };
const calls = [];
const triggers = [];
const routes = [];
let request;
class Component {
  constructor(args = {}) {
    this.args = args;
    this.currentUser = user;
    this.site = site;
    this.router = {
      currentURL: "/t/campus/8",
      transitionTo: (route) => routes.push(route),
    };
    this.appEvents = {
      on() {},
      off() {},
      trigger: (name, entry) => {
        triggers.push({ name, entry });
        this.onEntryChanged(entry);
      },
    };
  }

  willDestroy() {
    this.isDestroying = true;
  }
}
const common = {
  default: Component,
  action() {},
  tracked() {},
  service() {},
  fn() {},
  ajax: async (url, options) => {
    calls.push({ url, options });
    return request(url, options);
  },
  i18n: (key) => key,
  themePrefix: (key) => key,
  officialTimeLabel: (item) => `time-${item.id}`,
  OFFICIAL_CALENDAR_FIELD: "isbf_official_calendar_items",
  isOfficialCalendarPost,
};
const contents = read(
  "javascripts/discourse/components/isbf-official-calendar-items.gjs"
);
const code = contents
  .replace(/<template>[\s\S]*?<\/template>/g, "")
  .replace(/@service\s+\w+;\s*/g, "")
  .replace(/@(tracked|action)\s+/g, "");
const component = new vm.SourceTextModule(code, { context });
await component.link(() => synthetic(common));
await component.evaluate();
const CalendarItems = component.namespace.default;
const create = (items = [event], args = {}) =>
  new CalendarItems({
    outletArgs: { post: { ...post, isbf_official_calendar_items: items } },
    ...args,
  });
const single = create();
assert.equal(single.officialLayout, true);
assert.equal(single.topicTitle, "Campus");
assert.equal(single.items[0].addLabel, "isbf_v2.schedule_add");
assert.equal(
  create([event, deadline]).items[0].addLabel,
  "isbf_v2.schedule_add_event"
);
assert.equal(
  create([event, deadline]).items[1].addLabel,
  "isbf_v2.schedule_add_deadline"
);
assert.equal(
  create([{ ...event, personal_entry_id: 20 }]).items[0].addDisabled,
  true
);
assert.equal(
  create([{ ...event, cancelled: true }]).items[0].addDisabled,
  true
);
assert.equal(create([]).items.length, 0);
const visitor = create();
visitor.currentUser = null;
await visitor.add(visitor.items[0]);
assert.deepEqual(routes, ["login"]);
assert.equal(calls.length, 0);
const readonly = create([event], { readOnly: true });
await readonly.add(readonly.items[0]);
assert.equal(calls.length, 0);
let resolveAdd;
request = () =>
  new Promise((resolve) => {
    resolveAdd = resolve;
  });
const pending = single.add(single.items[0]);
assert.equal(single.items[0].busy, true);
await single.add(single.items[0]);
assert.equal(calls.length, 1);
resolveAdd({ entry: { id: 50, source_item_id: event.id } });
await pending;
assert.equal(calls[0].url, "/isbf/api/official-items/1/add.json");
assert.equal(calls[0].options.data.revision, 2);
assert.equal(triggers.length, 1);
assert.equal(single.items[0].added, true);
await single.add(single.items[0]);
assert.equal(calls.length, 1);
single.onEntryChanged({ id: 50, source_item_id: event.id, removed: true });
assert.equal(single.items[0].added, false);
const failed = create();
request = async () => {
  throw new Error("network");
};
await failed.add(failed.items[0]);
assert.equal(failed.error, true);
assert.equal(failed.items[0].busy, false);
request = async () => ({ entry: { id: 51, source_item_id: 1 } });
await failed.add(failed.items[0]);
assert.equal(failed.error, false);
assert.equal(failed.items[0].added, true);
const conflict = create();
request = async (url) => {
  if (url.startsWith("/isbf/")) {
    throw { jqXHR: { status: 409 } };
  }
  assert.equal(url, "/posts/15.json");
  return {
    isbf_official_calendar_items: [{ ...event, revision: 3 }],
    isbf_official_campuses: ["shenzhen"],
  };
};
await conflict.add(conflict.items[0]);
assert.equal(conflict.error, true);
assert.equal(conflict.items[0].revision, 3);
assert.equal(conflict.campusIds[0], "shenzhen");
const stale = create();
request = () =>
  new Promise((resolve) => {
    resolveAdd = resolve;
  });
const stalePending = stale.add(stale.items[0]);
const triggerCount = triggers.length;
stale.args = {
  outletArgs: {
    post: { ...post, id: 99, isbf_official_calendar_items: [deadline] },
  },
};
resolveAdd({ entry: { id: 55, source_item_id: event.id } });
await stalePending;
assert.equal(triggers.length, triggerCount);
const destroyed = create();
const destroyedPending = destroyed.add(destroyed.items[0]);
destroyed.willDestroy();
resolveAdd({ entry: { id: 56, source_item_id: 1 } });
await destroyedPending;
assert.equal(triggers.length, triggerCount);
assert.match(
  contents,
  /this\.officialLayout[\s\S]*?<ISBFOfficialActivitySummary/
);
assert.match(contents, /@campusIds=\{\{this\.campusIds\}\}/);
assert.match(contents, /@topicTitle=\{\{this\.topicTitle\}\}/);
assert.match(contents, /@readOnly|this\.args\.readOnly/);
const summary = read(
  "javascripts/discourse/components/isbf-official-activity-summary.gjs"
);
assert.match(
  summary,
  /\{\{#if \(has-block\)\}\}[\s\S]*?yield group\.item[\s\S]*?yield group\.deadline/
);
assert.doesNotMatch(summary, /#if group\.showTitle/);
assert.doesNotMatch(summary, /<(?:h3|strong)\b/);
assert.equal(
  (summary.match(/aria-label=\{\{group\.item\.title\}\}/g) || []).length,
  2
);
assert.match(
  read("javascripts/discourse/components/isbf-v2-feed-card.gjs"),
  /@topicTitle=\{\{@topic\.title\}\}/
);
assert.match(
  read("javascripts/discourse/api-initializers/isbf-official-calendar.gjs"),
  /post-article-class/
);
process.stdout.write(
  "Official detail scope, per-item calendar actions, retry, conflict and stale-response checks OK\n"
);
