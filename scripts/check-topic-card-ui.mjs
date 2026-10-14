import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../javascripts/discourse/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const context = vm.createContext({});
const synthetic = (exports) =>
  new vm.SyntheticModule(
    Object.keys(exports),
    function () {
      for (const [name, value] of Object.entries(exports)) {
        this.setExport(name, value);
      }
    },
    { context }
  );
const scope = new vm.SourceTextModule(read("lib/topic-card-scope.js"), {
  context,
});
await scope.link(() => {});
await scope.evaluate();
const {
  cardReplyCount,
  isFeedStylePost,
  isFeedStyleTopic,
  rememberSecondaryMenu,
  secondaryMenuFor,
} = scope.namespace;
const topic = {
  id: 23,
  archetype: "regular",
  replyCount: 12,
  title: "校园话题",
};
const firstPost = { topic, post_type: 1, post_number: 1, reply_count: 2 };
const replyPost = { ...firstPost, post_number: 7, reply_count: 3 };
const path = "/t/campus/23/7";
assert.equal(isFeedStyleTopic(topic, path), true);
assert.equal(isFeedStylePost(firstPost, path), true);
assert.equal(isFeedStylePost(replyPost, path), true);
for (const excludedPath of [
  "/admin",
  "/latest",
  "/categories",
  "/u/student",
  "/t",
  "",
]) {
  assert.equal(isFeedStyleTopic(topic, excludedPath), false);
  assert.equal(isFeedStylePost(firstPost, excludedPath), false);
}
assert.equal(
  isFeedStyleTopic({ ...topic, archetype: "private_message" }, path),
  false
);
assert.equal(isFeedStyleTopic({ ...topic, is_nested_view: true }, path), false);
for (const post_type of [2, 3, 4]) {
  assert.equal(isFeedStylePost({ ...firstPost, post_type }, path), false);
}
assert.equal(isFeedStylePost(firstPost, path, true), false);
assert.equal(isFeedStylePost(null, path), false);
assert.equal(cardReplyCount(firstPost), 12);
assert.equal(cardReplyCount(replyPost), 3);
assert.equal(cardReplyCount({ ...firstPost, topic: { replyCount: -2 } }), 0);
assert.equal(cardReplyCount({ ...replyPost, reply_count: "invalid" }), 0);
const sentinel = [["native", class NativeButton {}]];
rememberSecondaryMenu(firstPost, sentinel);
assert.equal(secondaryMenuFor(firstPost), sentinel);
assert.equal(secondaryMenuFor(replyPost).length, 0);

class Component {
  constructor(args = {}) {
    this.args = args;
  }
}
let quoteOptions;
const requests = [];
const common = {
  default: Component,
  action() {},
  tracked() {},
  service() {},
  fn() {},
  getOwner() {},
  secondaryMenuFor,
  compactNumber: (number) => (number ? String(number) : ""),
  openQuotedRepost: async (options) => {
    quoteOptions = options;
    return true;
  },
  cardReplyCount,
  ajax: async (url, options) => {
    requests.push({ url, options });
  },
  popupAjaxError: (error) => {
    throw error;
  },
  themePrefix: (key) => key,
  i18n: (key) => key,
  recordVisibleView: async () => 5,
  recordVisiblePostView: async () => 6,
};
async function componentModule(pathname) {
  const source = read(pathname)
    .replace(/<template>[\s\S]*?<\/template>/g, "")
    .replace(/@service\s+\w+;\s*/g, "")
    .replace(/@(tracked|action)\s+/g, "");
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => synthetic(common));
  await module.evaluate();
  return module.namespace;
}
const actions = await componentModule("components/isbf-topic-actions.gjs");
const Views = (await componentModule("components/isbf-topic-views.gjs"))
  .default;
assert.equal(Views.shouldRender({ post: firstPost }), true);
assert.equal(Views.shouldRender({ post: replyPost }), true);
assert.equal(
  Views.shouldRender({ post: { ...replyPost, post_type: 3 } }),
  false
);
const More = (await componentModule("components/isbf-topic-more.gjs")).default;
assert.equal(More.extraControls(), true);
assert.equal(More.shouldRender(), true);

const transformers = new Map();
const outlets = [];
const router = { currentURL: path };
const Metadata = class Metadata {};
const Handle = class Handle {};
const initializer = new vm.SourceTextModule(
  read("api-initializers/isbf-topic-card.gjs"),
  { context }
);
await initializer.link((name) => {
  if (name === "discourse/lib/api") {
    return synthetic({ apiInitializer: (callback) => callback });
  }
  if (name.endsWith("/topic-card-scope")) {
    return scope;
  }
  if (name.endsWith("/isbf-solved-action")) {
    return synthetic({ default: () => class NativeSolvedWrapper {} });
  }
  if (name.endsWith("/isbf-solved-summary")) {
    return synthetic({ default: class SolvedSummary {} });
  }
  if (name.endsWith("/isbf-topic-actions")) {
    return synthetic(Object.fromEntries(Object.entries(actions)));
  }
  if (name.endsWith("/isbf-topic-views")) {
    return synthetic({ default: Views });
  }
  if (name.endsWith("/isbf-topic-more")) {
    return synthetic({ default: More });
  }
  if (name.endsWith("/isbf-topic-metadata")) {
    return synthetic({ default: Metadata, ISBFTopicHandle: Handle });
  }
  throw new Error(`Unexpected initializer import: ${name}`);
});
await initializer.evaluate();
initializer.namespace.default({
  container: {
    lookup: (name) => {
      if (name === "service:site-settings") {
        return { solved_enabled: true };
      }
      assert.equal(name, "service:router");
      return router;
    },
  },
  renderInOutlet: (name, value) => outlets.push(["wrapper", name, value]),
  renderAfterWrapperOutlet: (name, value) =>
    outlets.push(["after", name, value]),
  registerValueTransformer: (name, callback) =>
    transformers.set(name, callback),
});
assert.equal(outlets.length, 2);
assert.deepEqual(outlets[0], ["wrapper", "post-metadata", Metadata]);
assert.equal(outlets[1][0], "after");
assert.equal(outlets[1][1], "post-content-cooked-html");

class SimpleDAG {
  nodes = new Map();
  mutations = 0;

  constructor(entries) {
    for (const [key, value] of entries) {
      this.nodes.set(key, { value, position: {} });
    }
  }

  entries() {
    const result = [];
    const pending = new Set(this.nodes.keys());
    while (pending.size) {
      const ready = [...pending].find((key) => {
        const { position } = this.nodes.get(key);
        return (
          (!position.after || !pending.has(position.after)) &&
          ![...pending].some(
            (other) => this.nodes.get(other).position.before === key
          )
        );
      });
      assert.notEqual(
        ready,
        undefined,
        "Button ordering must not contain a cycle"
      );
      pending.delete(ready);
      result.push([ready, this.nodes.get(ready).value]);
    }
    return result;
  }

  add(key, value, position = {}) {
    this.mutations++;
    this.nodes.set(key, { value, position });
  }

  delete(key) {
    this.mutations++;
    this.nodes.delete(key);
  }
}
const buttonKeys = {
  REPLY: "reply",
  LIKE: "like",
  BOOKMARK: "bookmark",
  SHOW_MORE: "showMore",
};
const nativeEntries = [
  "reply",
  "flag",
  "like",
  "edit",
  "bookmark",
  "delete",
  "pluginAction",
  "showMore",
].map((key) => [key, class NativeMenuButton {}]);
const dag = new SimpleDAG(nativeEntries);
const ordinaryContext = {
  post: firstPost,
  topic,
  state: { nestedReplyView: false },
  buttonKeys,
};
transformers.get("post-menu-buttons")({ value: dag, context: ordinaryContext });
assert.deepEqual(
  dag.entries().map(([key]) => key),
  [
    "isbfReply",
    "isbfRepost",
    "isbfLike",
    "isbfViews",
    "isbfBookmark",
    "showMore",
  ]
);
assert.equal(dag.entries()[3][1], Views);
assert.equal(dag.entries()[5][1], More);
const secondary = secondaryMenuFor(firstPost);
assert.deepEqual(
  Array.from(secondary, ([key]) => key),
  ["flag", "edit", "delete", "pluginAction"]
);
for (const [key, Button] of secondary) {
  assert.equal(
    Button,
    nativeEntries.find(([nativeKey]) => nativeKey === key)[1]
  );
}
assert.equal(secondaryMenuFor(replyPost).length, 0);

const exclusions = [
  { post: { ...firstPost, topic: { ...topic, archetype: "private_message" } } },
  { post: { ...firstPost, post_type: 2 } },
  { post: { ...firstPost, topic: { ...topic, is_nested_view: true } } },
  { post: firstPost, state: { nestedReplyView: true } },
  { post: firstPost, route: "/admin" },
  { post: firstPost, route: "/latest" },
];
for (const excluded of exclusions) {
  router.currentURL = excluded.route ?? path;
  const untouched = new SimpleDAG(nativeEntries);
  const testContext = {
    ...ordinaryContext,
    ...excluded,
    topic: excluded.post.topic,
  };
  transformers.get("post-menu-buttons")({
    value: untouched,
    context: testContext,
  });
  assert.equal(untouched.mutations, 0);
  assert.deepEqual(untouched.entries(), nativeEntries);
  for (const name of ["post-class", "post-article-class"]) {
    const classes = ["native-class"];
    assert.equal(
      transformers.get(name)({ value: classes, context: testContext }),
      classes
    );
  }
  assert.equal(
    transformers.get("post-show-topic-map")({
      value: true,
      context: testContext,
    }),
    true
  );
  if (excluded.post.post_type === 1 && !excluded.state?.nestedReplyView) {
    assert.equal(
      transformers.get("topic-show-footer-buttons")({
        value: true,
        context: testContext,
      }),
      true
    );
  }
}
router.currentURL = path;
for (const name of ["post-class", "post-article-class"]) {
  const classes = ["native-class"];
  const transformed = transformers.get(name)({
    value: classes,
    context: ordinaryContext,
  });
  assert.equal(transformed.length, 2);
  assert.equal(transformed[0], "native-class");
  assert.equal(classes.length, 1);
}
assert.equal(
  transformers.get("post-show-topic-map")({
    value: true,
    context: ordinaryContext,
  }),
  false
);
assert.equal(
  transformers.get("topic-show-footer-buttons")({
    value: true,
    context: ordinaryContext,
  }),
  false
);

const repost = new actions.ISBFTopicRepost({
  post: { ...replyPost, username: "student", cooked: "<p>回复正文</p>" },
});
repost.composer = {};
repost.router = router;
repost.currentUser = { id: 9 };
await repost.repost();
assert.equal(quoteOptions.postNumber, 7);
assert.equal(quoteOptions.topicId, 23);
assert.equal(quoteOptions.cookedHtml, "<p>回复正文</p>");
assert.equal(repost.busy, false);
assert.equal(new actions.ISBFTopicReply({ post: firstPost }).count, "12");
assert.equal(new actions.ISBFTopicReply({ post: replyPost }).count, "3");
const bookmarkTopic = {
  ...topic,
  bookmarked: false,
  set(key, value) {
    this[key] = value;
  },
};
const bookmark = new actions.ISBFTopicBookmark({
  post: { ...firstPost, topic: bookmarkTopic, canBookmark: true },
});
bookmark.currentUser = { id: 9 };
bookmark.router = router;
assert.equal(bookmark.isFirstPost, true);
await bookmark.bookmark();
assert.equal(requests[0].url, "/t/23/bookmark");
assert.equal(requests[0].options.type, "PUT");
await bookmark.bookmark();
assert.equal(requests[1].url, "/t/23/remove_bookmarks");
assert.equal(requests[1].options.type, "DELETE");
assert.equal(bookmarkTopic.bookmarked, false);
const forbiddenBookmark = new actions.ISBFTopicBookmark({
  post: { ...firstPost, topic: bookmarkTopic, canBookmark: false },
});
forbiddenBookmark.currentUser = { id: 9 };
await forbiddenBookmark.bookmark();
assert.equal(requests.length, 2);
let loginRoute;
forbiddenBookmark.currentUser = null;
forbiddenBookmark.router = {
  transitionTo(route) {
    loginRoute = route;
  },
};
await forbiddenBookmark.bookmark();
assert.equal(loginRoute, "login");
assert.equal(requests.length, 2);
assert.equal(
  new actions.ISBFTopicBookmark({ post: replyPost }).isFirstPost,
  false
);
const actionSource = read("components/isbf-topic-actions.gjs");
assert.match(actionSource, /@action=\{\{@buttonActions\.replyToPost\}\}/);
assert.match(
  actionSource,
  /\{\{#if this\.isFirstPost\}\}[\s\S]*?\{\{else\}\}\s*<PostMenuBookmarkButton[\s\S]*?@buttonActions=\{\{@buttonActions\}\}/
);
console.log(
  "Topic card guards, native menu retention, primary order, quote target and bookmark delegation OK"
);
