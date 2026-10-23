import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const source = (path) =>
  readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => {
  for (let index = 0; index < 12; index++) {
    await Promise.resolve();
  }
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function load(text, dependencies, globals = {}) {
  const context = vm.createContext(globals);
  const module = new vm.SourceTextModule(text, { context });
  await module.link((name) => {
    const values = dependencies[name];
    assert.ok(values, `Unexpected dependency ${name}`);
    return new vm.SyntheticModule(
      Object.keys(values),
      function () {
        for (const [key, value] of Object.entries(values)) {
          this.setExport(key, value);
        }
      },
      { context }
    );
  });
  await module.evaluate();
  return module.namespace;
}

let roundAvailable = true;
const roundCalls = [];
const preview = await load(
  source("javascripts/discourse/lib/poll-preview.js"),
  {
    "discourse/lib/utilities": {
      optionalRequire: (name) => {
        assert.equal(name, "discourse/plugins/poll/lib/even-round");
        return roundAvailable
          ? (values) => {
              roundCalls.push([...values]);
              // Contract fixture: native receives the complete, vote-sorted option set.
              assert.equal(values.length, 4);
              return [50, 17, 17, 16];
            }
          : null;
      },
    },
  }
);
const descriptors = [
  {
    name: "poll",
    title: "Question",
    type: "regular",
    options: ["a", "b", "c", "d"].map((id) => ({
      id,
      label: id.toUpperCase(),
    })),
  },
];
const metadata = [
  {
    name: "poll",
    type: "regular",
    voters: 6,
    status: "open",
    options: ["d", "c", "b", "a"].map((id) => ({
      id,
      html: id,
      votes: id === "d" ? 3 : 1,
    })),
  },
];
const before = JSON.stringify({ descriptors, metadata });
let result = preview.buildPollPreviews(descriptors, metadata)[0];
assert.deepEqual(plain(result.options.map((option) => option.id)), [
  "a",
  "b",
  "c",
]);
assert.deepEqual(
  plain(result.options.map((option) => option.percentage)),
  [17, 17, 16]
);
assert.equal(result.remaining, 1);
assert.equal(result.voters, 6);
assert.equal(roundCalls.length, 1);
assert.equal(roundCalls[0][0], 50);
assert.equal(
  roundCalls[0].length,
  4,
  "Rounding must happen before truncating options"
);
assert.equal(
  JSON.stringify({ descriptors, metadata }),
  before,
  "Do not mutate native data"
);
const variants = (patch) => [{ ...metadata[0], ...patch }];
result = preview.buildPollPreviews(
  descriptors,
  variants({ type: "multiple", voters: 3 })
)[0];
assert.deepEqual(
  plain(result.options.map((option) => option.percentage)),
  [33, 33, 33]
);
assert.equal(
  roundCalls.length,
  1,
  "Multiple choices use floor, not even rounding"
);
for (const missing of [
  [],
  variants({
    options: metadata[0].options.map((option) => ({
      id: option.id,
      html: option.html,
    })),
  }),
  variants({ voters: undefined }),
  variants({ options: metadata[0].options.slice(1) }),
]) {
  result = preview.buildPollPreviews(descriptors, missing)[0];
  assert.equal(result.voters, null);
  assert.ok(
    result.options.every((option) => option.percentage === null),
    "Omitted native results are hidden, not zero"
  );
}
result = preview.buildPollPreviews(
  descriptors,
  variants({
    voters: 0,
    options: metadata[0].options.map((option) => ({ ...option, votes: 0 })),
  })
)[0];
assert.equal(result.voters, 0);
assert.ok(result.options.every((option) => option.percentage === 0));
result = preview.buildPollPreviews(
  descriptors,
  variants({ type: "ranked_choice", status: "closed" })
)[0];
assert.ok(result.options.every((option) => option.percentage === null));
assert.equal(result.closed, true);
preview.buildPollPreviews(descriptors, variants({ type: "number" }));
assert.equal(
  roundCalls.length,
  2,
  "Number distributions retain native rounding"
);
roundAvailable = false;
assert.ok(
  preview
    .buildPollPreviews(descriptors, metadata)[0]
    .options.every((option) => option.percentage === null)
);
assert.deepEqual(plain(preview.extractFeedPolls("<p>No poll</p>")), {
  html: "<p>No poll</p>",
  polls: [],
});

let now = 100000;
const calls = [];
let active = 0;
let peak = 0;
const loader = await load(
  source("javascripts/discourse/lib/feed-post-loader.js"),
  {
    "discourse/lib/ajax": {
      ajax: (url) => {
        const request = deferred();
        active++;
        peak = Math.max(peak, active);
        calls.push({ url, ...request });
        return request.promise.finally(() => active--);
      },
    },
  },
  {
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    setTimeout,
  }
);
const { loadPostPolls, loadCookedPost, invalidateCookedPost } = loader;
for (const id of [0, -1, NaN, "bad", 1.5]) {
  assert.equal(await loadPostPolls(id, null), null);
}
assert.equal(calls.length, 0);
const first = loadPostPolls(1, 11);
assert.equal(
  loadPostPolls(1, 11, { refresh: true }),
  first,
  "Deduplicate pending refreshes"
);
const batch = [
  first,
  loadPostPolls(2, 11),
  loadCookedPost(3),
  loadCookedPost(4),
  loadPostPolls(5, 11),
  loadCookedPost(6),
];
assert.equal(calls.length, 4, "Poll and cooked requests share four slots");
for (let index = 0; index < 6; index++) {
  calls[index].resolve({ cooked: `body-${index}`, polls: [] });
  await flush();
}
await Promise.all(batch);
assert.equal(peak, 4);
assert.equal(calls.length, 6);
assert.equal((await loadPostPolls(1, 11)).cooked, "body-0");
assert.equal(calls.length, 6, "Reuse fresh metadata for the same viewer");
const refresh = loadPostPolls(1, 11, { refresh: true });
calls[6].resolve({ cooked: "fresh", polls: [] });
await refresh;
const otherUser = loadPostPolls(1, 12);
calls[7].resolve({ cooked: "other-user", polls: [] });
await otherUser;
assert.equal((await loadPostPolls(1, 11)).cooked, "fresh");
const guest = loadPostPolls(1, null);
calls[8].resolve({ cooked: "guest", polls: [] });
await guest;
now += 30001;
const expired = loadPostPolls(1, 11);
calls[9].resolve({ cooked: "expired-reloaded", polls: [] });
await expired;
const failure = loadPostPolls(7, 11);
const rejected = assert.rejects(failure, /network/);
calls[10].reject(new Error("network"));
await rejected;
const retry = loadPostPolls(7, 11);
calls[11].resolve({ polls: [] });
await retry;
const stale = loadPostPolls(8, 11);
invalidateCookedPost(8);
assert.equal(
  await loadPostPolls(8, 11),
  null,
  "Hidden posts cannot enqueue requests"
);
calls[12].resolve({ polls: metadata });
assert.equal(await stale, null, "Discard inflight metadata for hidden posts");
invalidateCookedPost(8, false);
const old = loadPostPolls(8, 11);
invalidateCookedPost(8, false);
const newer = loadPostPolls(8, 11);
calls[14].resolve({ cooked: "new-generation", polls: [] });
await newer;
calls[13].resolve({ cooked: "old-generation", polls: metadata });
assert.equal(await old, null);
assert.equal((await loadPostPolls(8, 11)).cooked, "new-generation");
invalidateCookedPost(1, false);
const invalidatedOtherUser = loadPostPolls(1, 12);
calls[15].resolve({ polls: [] });
await invalidatedOtherUser;

roundAvailable = true;
const componentText = source(
  "javascripts/discourse/components/isbf-poll-previews.gjs"
);
const componentRequests = [];
let viewer = { id: 11 };
class Component {
  constructor(args) {
    this.args = args;
    this.currentUser = viewer;
  }

  willDestroy() {
    this.isDestroying = true;
  }
}
const component = await load(
  componentText
    .replace(/<template>[\s\S]*?<\/template>/g, "")
    .replace(/@service\s+\w+;\s*/g, "")
    .replace(/@(tracked|action)\s+/g, ""),
  {
    "@glimmer/component": { default: Component },
    "@glimmer/tracking": { tracked: () => {} },
    "@ember/object": { action: () => {} },
    "@ember/render-modifiers/modifiers/did-update": { default: () => {} },
    "@ember/service": { service: () => {} },
    "@ember/template": { trustHTML: (value) => value },
    "virtual:theme": { themePrefix: (key) => key },
    "discourse-i18n": { i18n: (key) => key },
    "../lib/feed-post-loader": {
      loadPostPolls: (...args) => {
        const request = deferred();
        componentRequests.push({ ...request, args });
        return request.promise;
      },
    },
    "../lib/poll-preview": {
      buildPollPreviews: preview.buildPollPreviews,
      extractFeedPolls: () => ({ polls: descriptors }),
    },
  }
);
const PollPreviews = component.default;
const instance = new PollPreviews({ postId: 9, cooked: "first" });
assert.equal(componentRequests[0].args[2].refresh, true);
instance.args = { postId: 10, cooked: "second" };
const update = instance.load();
componentRequests[0].resolve({ cooked: "stale", polls: metadata });
await flush();
assert.equal(instance.data, null);
componentRequests[1].resolve({ cooked: "current", polls: metadata });
await update;
assert.equal(instance.data.cooked, "current");
assert.ok(
  instance.polls[0].options.every((option) => option.percentage !== null)
);
instance.currentUser = { id: 12 };
assert.ok(
  instance.polls[0].options.every((option) => option.percentage === null),
  "Changing viewer immediately hides previous results"
);
const failedLoad = instance.load();
componentRequests[2].reject(new Error("retry"));
await failedLoad;
assert.equal(instance.failed, true);
assert.equal(instance.data, null);
const successfulRetry = instance.load();
componentRequests[3].resolve({ polls: metadata });
await successfulRetry;
assert.equal(instance.failed, false);
const destroyed = instance.load();
instance.willDestroy();
componentRequests[4].resolve({ cooked: "destroyed", polls: metadata });
await destroyed;
assert.equal(instance.data, null);
viewer = null;
const measurement = new PollPreviews({
  postId: 11,
  cooked: "measure",
  measureOnly: true,
});
assert.equal(measurement.data, null);
assert.equal(componentRequests.length, 5, "Measurement clones must not fetch");

const extraction = source("javascripts/discourse/lib/poll-preview.js");
assert.match(extraction, /closest\("aside\.quote"\)/);
assert.match(extraction, /img\.emoji/);
assert.match(extraction, /\.poll-outer/);
assert.match(extraction, /\.remove\(\)/);
const feed = source("javascripts/discourse/components/isbf-v2-feed-card.gjs");
assert.match(
  feed,
  /this\.#pollContentFor\(this\.hidden \? "" : this\.body \|\| ""\)/
);
assert.match(feed, /extractFeedPolls\(body\)/);
assert.match(feed, /body !== this\.#pollBody/);
assert.ok(
  feed.indexOf("<ISBFPollPreviews") >
    feed.indexOf("{{/if}}</div>", feed.indexOf('"isbf-feed-card__body"'))
);
assert.match(
  componentText,
  /<a class="isbf-poll-preview__link" href={{@topicUrl}}/
);
assert.doesNotMatch(
  componentText,
  /cast-votes|insertPoll|\/polls\/vote|setInterval|<input|type="radio"/
);
assert.match(
  componentText,
  /didUpdate this\.load @postId @cooked this\.viewerId/
);
const styles = source("stylesheets/poll.scss");
assert.match(styles, /body:has\(\.isbf-v2-shell\):not\(\.admin-interface\)/);
assert.match(styles, /\.topic-post \.cooked \.poll-outer \.poll/);
assert.match(styles, /min-height: 44px/);
assert.match(styles, /minmax\(0, 1fr\) max-content/);
assert.match(styles, /min-width: 0/);
assert.match(styles, /@media \(width <= 600px\)/);
assert.match(styles, /var\(--isbf-v2-accent\)/);
assert.match(styles, /&__link \{[\s\S]*?margin-inline-start: auto/);
assert.match(
  styles,
  /\.poll-voters-list \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap/
);
assert.match(styles, /img\.avatar,[\s\S]*?width: 24px;[\s\S]*?margin: 0/);
assert.doesNotMatch(styles, /position:\s*fixed/);
assert.match(
  source(".github/workflows/check.yml"),
  /scripts\/check-poll-display\.mjs/
);
process.stdout.write(
  "Poll display permissions, percentages, shared request lifecycle, viewer isolation, stale responses, retry and layout constraints OK\n"
);
