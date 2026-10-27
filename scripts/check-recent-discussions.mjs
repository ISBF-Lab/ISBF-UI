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
async function sourceModule(path, dependencies = {}) {
  const source = read(path)
    .replace(/<template>[\s\S]*?<\/template>/g, "")
    .replace(/@service\s+\w+;\s*/g, "")
    .replace(/@(tracked|cached|action)\s+/g, "");
  const module = new vm.SourceTextModule(source, { context });
  await module.link((name) => {
    const dependency = dependencies[name];
    assert.ok(dependency, `Unexpected import ${name} in ${path}`);
    return dependency instanceof vm.Module ? dependency : synthetic(dependency);
  });
  await module.evaluate();
  return module;
}
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
const marketplace = await sourceModule(
  "javascripts/discourse/lib/marketplace.js"
);
const teamup = await sourceModule("javascripts/discourse/lib/teamup.js");
const careers = await sourceModule("javascripts/discourse/lib/careers.js");
const recent = await sourceModule(
  "javascripts/discourse/lib/recent-discussions.js",
  {
    "discourse/lib/ajax": {
      ajax: () => {
        throw new Error("Tests must inject request");
      },
    },
    "./marketplace": marketplace,
    "./teamup": teamup,
    "./careers": careers,
  }
);
const { loadRecentDiscussions } = recent.namespace;
const now = Date.parse("2026-10-11T12:00:00Z");
const hoursAgo = (hours) =>
  new Date(now - hours * 60 * 60 * 1000).toISOString();
const topic = (id, extra = {}) => ({
  id,
  title: `Topic ${id}`,
  slug: `topic-${id}`,
  first_post_id: id * 10,
  created_at: hoursAgo(1),
  posts_count: 1,
  category_id: 2,
  ...extra,
});
const page = (topics, more_topics_url = null) => ({
  topic_list: { topics, more_topics_url },
});
const site = {
  isbf_marketplace: { category_id: 8, private_images: true, version: 1 },
};
const calls = [];
const first = [
  topic(1, { posts_count: 500, created_at: hoursAgo(72.001) }),
  topic(2, { category_id: 8 }),
  topic(3, { isbf_marketplace: { show_on_home: false } }),
  topic(4, { created_at: "malformed" }),
  topic(5, { created_at: null }),
  topic(30, { created_at: hoursAgo(-1) }),
  topic(31, { created_at: undefined }),
  topic(90, { posts_count: 8 }),
  ...Array.from({ length: 30 }, (_, index) =>
    topic(100 + index, { category_id: 8 })
  ),
];
const eligible = topic(7, {
  category_id: 8,
  isbf_marketplace: { show_on_home: true },
});
const pages = [
  page(first, "/filter.json?page=1"),
  page(
    [
      first[7],
      eligible,
      topic(10, { created_at: hoursAgo(72) }),
      topic(6, { posts_count: 1 }),
      topic(9),
    ],
    "/filter.json?page=2"
  ),
];
const selected = await loadRecentDiscussions({
  site,
  now,
  request: async (url, options) => {
    calls.push({ url, options });
    assert.ok(pages.length, "Stop after four eligible discussions");
    return pages.shift();
  },
});
assert.deepEqual(
  Array.from(selected, (item) => item.id),
  [90, 7, 10, 6]
);
assert.equal(selected[0], first[7], "Keep native topic data and order");
assert.equal(selected[1], eligible);
assert.equal(calls.length, 2, "Continue beyond 30 excluded discussions");
assert.equal(calls[0].url, "/filter.json");
assert.equal(calls[0].options.data.q, "created-after:3 order:posts,created");
assert.equal(calls[0].options.data.page, 0);
assert.equal(calls[1].url, "/filter.json");
assert.equal(calls[1].options.data.page, 1);
assert.equal(
  await loadRecentDiscussions({ now, request: async () => page([]) }).then(
    (result) => result.length
  ),
  0
);
assert.equal(
  await loadRecentDiscussions({ now, request: async () => ({}) }).then(
    (result) => result.length
  ),
  0
);
const noConfig = await loadRecentDiscussions({
  now,
  request: async () =>
    page([
      topic(2, { category_id: 8 }),
      topic(3, { isbf_marketplace: { show_on_home: false } }),
    ]),
});
assert.deepEqual(
  Array.from(noConfig, (item) => item.id),
  [2]
);
const careersSite = {
  isbf_careers: { category_id: 12, enabled: true, version: 1 },
};
const careersOptIn = topic(302, {
  category_id: 12,
  isbf_careers: { show_on_home: true },
});
const careersLegacy = topic(303, {
  category_id: 12,
  isbf_careers: { show_on_home: true },
});
const careersPages = [
  page(
    Array.from({ length: 30 }, (_, index) =>
      topic(400 + index, {
        category_id: 12,
        isbf_careers: { show_on_home: false },
      })
    ),
    "/filter.json?page=1"
  ),
  page(
    [
      topic(301, { isbf_careers: { show_on_home: false } }),
      careersOptIn,
      careersLegacy,
      topic(304),
    ],
    "/filter.json?page=2"
  ),
  page([careersOptIn, topic(305), topic(306)]),
];
let careersCalls = 0;
const careersSelected = await loadRecentDiscussions({
  site: careersSite,
  now,
  request: async (_url, options) => {
    assert.equal(options.data.page, careersCalls++);
    assert.ok(careersPages.length, "Stop after filling four eligible topics");
    return careersPages.shift();
  },
});
assert.deepEqual(
  Array.from(careersSelected, (item) => item.id),
  [302, 303, 304, 305]
);
assert.equal(
  careersCalls,
  3,
  "Default false Careers listings must not starve the four item rail"
);
assert.equal(careersSelected[0], careersOptIn);
assert.equal(
  careersSelected[1],
  careersLegacy,
  "Serialized legacy visible listings remain eligible"
);
let duplicateCalls = 0;
const duplicateOnly = await loadRecentDiscussions({
  now,
  request: async () => {
    duplicateCalls++;
    assert.ok(duplicateCalls <= 2, "Repeated pages must terminate");
    return page([topic(20)], `/filter.json?page=${duplicateCalls}`);
  },
});
assert.deepEqual(
  Array.from(duplicateOnly, (item) => item.id),
  [20]
);
assert.equal(duplicateCalls, 2);
await assert.rejects(
  loadRecentDiscussions({
    now,
    request: async () => {
      throw new Error("offline");
    },
  }),
  /offline/
);
let stale = false;
const inFlight = deferred();
const staleResult = loadRecentDiscussions({
  now,
  request: () => inFlight.promise,
  isStale: () => stale,
});
stale = true;
inFlight.resolve(page([topic(1)], "/filter.json?page=1"));
assert.equal((await staleResult).length, 0);
let staleCalls = 0;
assert.equal(
  (
    await loadRecentDiscussions({
      now,
      isStale: () => true,
      request: async () => {
        staleCalls++;
        return page([]);
      },
    })
  ).length,
  0
);
assert.equal(staleCalls, 0);
console.log(
  "Recent discussions: rolling 72h, server order, marketplace eligibility, pagination, dedup, errors and stale requests OK"
);

const optionalTitle = await sourceModule(
  "javascripts/discourse/lib/optional-topic-title.js"
);
const observers = [];
class Observer {
  constructor(callback) {
    this.callback = callback;
    observers.push(this);
  }

  observe(element) {
    this.element = element;
  }

  disconnect() {
    this.disconnected = true;
  }

  intersect() {
    this.callback([{ isIntersecting: true }]);
  }
}
context.IntersectionObserver = Observer;
class Component {
  constructor(_owner, args = {}) {
    this.args = args;
    this.site = site;
  }

  willDestroy() {}
}
const parsed = {
  body: { text: "正文摘要 😀", images: [] },
  image: { text: "", images: [{ src: "https://campus.example/image.png" }] },
  empty: { text: "", images: [] },
  mixed: {
    text: "正文和图片",
    images: [1, 2, 3].map((id) => ({
      src: `https://campus.example/${id}.png`,
    })),
  },
};
const bodyRequests = [];
const Preview = (
  await sourceModule("javascripts/discourse/components/isbf-post-preview.gjs", {
    "@glimmer/component": { default: Component },
    "@glimmer/tracking": { cached() {}, tracked() {} },
    "@ember/helper": { fn() {} },
    "@ember/modifier": { on() {} },
    "@ember/object": { action() {} },
    "@ember/render-modifiers/modifiers/did-insert": { default() {} },
    "@ember/render-modifiers/modifiers/did-update": { default() {} },
    "@ember/render-modifiers/modifiers/will-destroy": { default() {} },
    "virtual:theme": { themePrefix: (key) => key },
    "discourse/ui-kit/helpers/d-concat-class": { default() {} },
    "discourse/ui-kit/helpers/d-icon": { default() {} },
    "discourse/ui-kit/helpers/d-replace-emoji": { default() {} },
    "discourse-i18n": {
      i18n: (key) =>
        ({
          "isbf_v2.preview_picture": "图片",
          "isbf_v2.preview_post": "查看帖子",
          "isbf_v2.preview_open": "查看帖子",
        })[key] ?? key,
    },
    "../lib/feed-post-loader": {
      loadCookedPost: (postId) => {
        const request = { postId, ...deferred() };
        bodyRequests.push(request);
        return request.promise;
      },
    },
    "../lib/optional-topic-title": optionalTitle,
    "../lib/post-preview": {
      postPreview: (html) => parsed[html] ?? parsed.empty,
    },
  })
).namespace.default;
const internal =
  "校园动态 [isbf-untitled:123e4567-e89b-12d3-a456-426614174000]";
const rail = (args = {}) =>
  new Preview(null, {
    variant: "rail",
    title: internal,
    postId: 10,
    excerpt: "body",
    href: "/t/topic/1",
    ...args,
  });
const titled = rail({ title: "真正标题", excerpt: "mixed" });
assert.equal(titled.text, "真正标题");
assert.equal(titled.images.length, 0);
titled.observe({});
assert.equal(
  observers.length,
  0,
  "Real rail titles need no cooked-post request"
);
for (const [excerpt, text] of [
  ["body", "正文摘要 😀"],
  ["image", "图片"],
  ["empty", "查看帖子"],
  ["mixed", "正文和图片"],
]) {
  const preview = rail({ excerpt });
  assert.equal(preview.text, text);
  preview._preview = parsed[excerpt];
  assert.equal(preview.images.length, 0, "Rail never displays images");
  assert.equal(preview.args.href, "/t/topic/1");
}
const activity = new Preview(null, {
  variant: "activity",
  title: "真正标题",
  excerpt: "body",
  postId: 11,
});
assert.equal(activity.text, "正文摘要 😀", "Activity keeps body priority");
activity._preview = parsed.mixed;
assert.deepEqual(plain(activity.images), parsed.mixed.images);
activity.imageFailed(parsed.mixed.images[0].src);
assert.deepEqual(plain(activity.images), parsed.mixed.images.slice(1));
const loading = rail();
loading.observe({});
const firstObserver = observers.at(-1);
firstObserver.intersect();
firstObserver.intersect();
assert.equal(
  bodyRequests.length,
  1,
  "Repeated observer callbacks make one request"
);
loading.args = { ...loading.args, postId: 12, excerpt: "image" };
loading.observe({});
assert.equal(firstObserver.disconnected, true);
observers.at(-1).intersect();
bodyRequests[0].resolve("body");
await flush();
assert.equal(
  loading.text,
  "图片",
  "Older response cannot replace the new topic excerpt"
);
bodyRequests[1].resolve("mixed");
await flush();
assert.equal(loading.text, "正文和图片");
assert.equal(loading.images.length, 0);
const failed = rail();
failed.observe({});
observers.at(-1).intersect();
bodyRequests.at(-1).reject(new Error("offline"));
await flush();
assert.equal(
  failed.text,
  "正文摘要 😀",
  "Failed cooked request preserves excerpt"
);
const destroyed = rail({ excerpt: "image" });
destroyed.observe({});
observers.at(-1).intersect();
destroyed.destroyObserver();
bodyRequests.at(-1).resolve("mixed");
await flush();
assert.equal(
  destroyed.text,
  "图片",
  "Destroyed observer rejects late response"
);
const destroying = rail({ excerpt: "image" });
destroying.observe({});
observers.at(-1).intersect();
destroying.isDestroying = true;
bodyRequests.at(-1).resolve("mixed");
await flush();
assert.equal(destroying.text, "图片");
const priorObservers = observers.length;
rail({ disabled: true }).observe({});
rail({ postId: 0 }).observe({});
assert.equal(observers.length, priorObservers);
console.log(
  "Post preview: title/body/image/empty fallbacks, no rail images, activity retention, failure and observer lifecycle OK"
);

const railRequests = [];
const RightRail = (
  await sourceModule(
    "javascripts/discourse/components/isbf-v2-right-rail.gjs",
    {
      "@glimmer/component": { default: Component },
      "@glimmer/tracking": { tracked() {} },
      "@ember/service": { service() {} },
      "virtual:theme": { settings: {}, themePrefix: (key) => key },
      "discourse/ui-kit/helpers/d-icon": { default() {} },
      "discourse-i18n": { i18n: (key) => key },
      "../lib/recent-discussions": {
        loadRecentDiscussions: (options) => {
          const request = { options, ...deferred() };
          railRequests.push(request);
          return request.promise;
        },
      },
      "./isbf-post-preview": { default: Preview },
    }
  )
).namespace.default;
const populatedRail = new RightRail();
assert.equal(railRequests[0].options.site, site);
const nativeRailTopic = topic(70, { excerpt: "body" });
railRequests[0].resolve([nativeRailTopic]);
await flush();
assert.deepEqual(plain(populatedRail.topics), [
  {
    id: 70,
    title: "Topic 70",
    postId: 700,
    excerpt: "body",
    href: "/t/topic-70/70",
  },
]);
const removedRail = new RightRail();
removedRail.willDestroy();
assert.equal(railRequests.at(-1).options.isStale(), true);
railRequests.at(-1).resolve([nativeRailTopic]);
await flush();
assert.equal(removedRail.topics.length, 0);
const failingRail = new RightRail();
railRequests.at(-1).reject(new Error("offline"));
await flush();
assert.equal(failingRail.topics.length, 0);
const destroyingRail = new RightRail();
destroyingRail.isDestroying = true;
assert.equal(railRequests.at(-1).options.isStale(), true);
railRequests.at(-1).resolve([nativeRailTopic]);
await flush();
assert.equal(destroyingRail.topics.length, 0);
console.log(
  "Right rail: native topic mapping, marketplace site dependency, offline and destruction guards OK"
);

const cookedRequests = [];
const loader = await sourceModule(
  "javascripts/discourse/lib/feed-post-loader.js",
  {
    "discourse/lib/ajax": {
      ajax: (url) => {
        const request = { url, ...deferred() };
        cookedRequests.push(request);
        return request.promise;
      },
    },
  }
);
const { loadCookedPost, invalidateCookedPost } = loader.namespace;
const jobs = Array.from({ length: 6 }, (_, index) => loadCookedPost(index + 1));
assert.equal(
  cookedRequests.length,
  4,
  "Cooked loader caps parallel requests at four"
);
cookedRequests[0].resolve({ cooked: "cached body" });
await flush();
assert.equal(cookedRequests.length, 5);
assert.equal(await loadCookedPost(1), "cached body");
assert.equal(cookedRequests.length, 5, "Cached body makes no repeat request");
cookedRequests[1].reject(new Error("offline"));
await assert.rejects(jobs[1], /offline/);
await flush();
assert.equal(cookedRequests.length, 6, "Failure frees a concurrency slot");
for (const request of cookedRequests.slice(2)) {
  request.resolve({ cooked: "body" });
}
await Promise.all(jobs.filter((_job, index) => index !== 1));
await flush();
const hidden = loadCookedPost(77);
invalidateCookedPost(77);
cookedRequests.at(-1).resolve({ cooked: "hidden body" });
assert.equal(await hidden, "");
const count = cookedRequests.length;
assert.equal(await loadCookedPost(77), "");
assert.equal(cookedRequests.length, count);
invalidateCookedPost(77, false);
const restored = loadCookedPost(77);
cookedRequests.at(-1).resolve({ cooked: "restored body" });
assert.equal(await restored, "restored body");
console.log(
  "Native cooked loader: cache, concurrency, rejection recovery and invalidation OK"
);

const parser = read("javascripts/discourse/lib/post-preview.js");
assert.match(parser, /new DOMParser\(\)\.parseFromString/);
assert.match(parser, /script, style, iframe, aside\.quote, aside\.onebox/);
assert.match(parser, /img:not\(\.emoji\)/);
assert.match(
  parser,
  /replaceWith\(document\.createTextNode\(image\.getAttribute\("alt"\)/
);
assert.match(parser, /body\.textContent\.replace\(/);
const previewSource = read(
  "javascripts/discourse/components/isbf-post-preview.gjs"
);
assert.match(previewSource, /href=\{\{@href\}\}/);
assert.match(previewSource, /dReplaceEmoji this\.text/);
const railSource = read(
  "javascripts/discourse/components/isbf-v2-right-rail.gjs"
);
assert.match(railSource, /loadRecentDiscussions/);
assert.match(railSource, /@variant="rail"/);
assert.match(railSource, /@postId=\{\{topic\.postId\}\}/);
assert.match(railSource, /href="\/latest"/);
const css = read("common/common.scss");
const hiddenRail = css.match(
  /@media \(width <= (1279)px\)[\s\S]*?\.isbf-v2-rail\s*\{\s*display: none;/
);
assert.ok(hiddenRail);
const railBreakpoint = Number(hiddenRail[1]);
for (const width of [390, 430, 1024, 1440]) {
  assert.equal(
    width <= railBreakpoint,
    width !== 1440,
    `Rail source breakpoint at ${width}px`
  );
}
const railStyles = css.slice(
  css.lastIndexOf(".isbf-v2-rail__panel .isbf-post-preview.--rail")
);
assert.match(
  railStyles,
  /^\.isbf-v2-rail__panel \.isbf-post-preview\.--rail\s*\{\s*display: flex;/
);
const textStyles = railStyles.match(
  /\.isbf-post-preview__text\s*\{([^}]+)\}/
)?.[1];
assert.ok(textStyles);
for (const declaration of [
  "display: block",
  "flex: 1",
  "min-width: 0",
  "overflow: hidden",
  "text-overflow: ellipsis",
  "white-space: nowrap",
]) {
  assert.ok(
    textStyles.includes(declaration),
    `Rail text requires ${declaration}`
  );
}
assert.match(railStyles, /> \.d-icon\s*\{\s*flex: none;/);
console.log(
  "Preview parser and native-link wiring checked; 390/430/1024 rail hiding and 1440 desktop source breakpoint checked (no browser rendering)"
);
