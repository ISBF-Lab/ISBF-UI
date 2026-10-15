import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const context = vm.createContext({
  document: { querySelector: () => ({}) },
  crypto: { randomUUID: () => "12345678-1234-4234-8234-123456789abc" },
});
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
async function load(path, dependencies = {}) {
  const source = read(path)
    .replace(/<template>[\s\S]*?<\/template>/g, "")
    .replace(/@service\s+\w+;\s*/g, "")
    .replace(/@(action|tracked|cached)\s+/g, "");
  const module = new vm.SourceTextModule(source, { context });
  await module.link((name) => {
    assert.ok(dependencies[name], `Unexpected import ${name} in ${path}`);
    return dependencies[name] instanceof vm.Module
      ? dependencies[name]
      : synthetic(dependencies[name]);
  });
  await module.evaluate();
  return module;
}
const lib = "javascripts/discourse/lib/";
const invalidations = [];
const teamup = await load(`${lib}teamup.js`);
const marketplace = await load(`${lib}marketplace.js`);
const careers = await load(`${lib}careers.js`);
const optional = await load(`${lib}optional-topic-title.js`);
const quick = await load(`${lib}quick-post-scope.js`, {
  "virtual:theme": { settings: { calendar_category_id: 9 } },
  "./marketplace": marketplace,
  "./teamup": teamup,
  "./careers": careers,
});
const anonymous = await load(`${lib}anonymous-post-scope.js`, {
  "discourse/models/category": {
    default: { findById: () => ({ read_restricted: false }) },
  },
  "./marketplace": marketplace,
  "./teamup": teamup,
  "./careers": careers,
});
const {
  teamupConfig,
  isTeamupComposer,
  restoreTeamup,
  teamupPayload,
  TEAMUP_HOME_FIELD,
} = teamup.namespace;
const config = { category_id: 42, version: 1, enabled: true };
const model = (extra = {}) => ({
  site: { isbf_teamup: config },
  categoryId: 42,
  creatingTopic: true,
  action: "createTopic",
  title: "组队",
  reply: "一起学习",
  set(key, value) {
    this[key] = value;
  },
  setProperties(values) {
    Object.assign(this, values);
  },
  ...extra,
});
assert.equal(teamupConfig({ isbf_teamup: config }), config);
for (const invalid of [
  undefined,
  {},
  { ...config, category_id: "42" },
  { ...config, category_id: 0 },
  { ...config, version: 2 },
  { ...config, enabled: false },
]) {
  assert.equal(teamupConfig({ isbf_teamup: invalid }), null);
}
assert.equal(
  teamupConfig({ isbf_teamup: { category_id: 42, version: 1 } }).category_id,
  42
);
assert.equal(teamup.namespace.teamupQuery().q, "isbf-teamup:all order:created");
const fresh = model({ isbf_anonymous: true });
restoreTeamup(fresh);
assert.equal(fresh.isbf_anonymous, false);
assert.equal(teamupPayload(fresh), false);
for (const home of [true, false]) {
  const draft = model({ isbf_teamup_home: !home });
  restoreTeamup(draft, { isbf_teamup_home: home });
  assert.equal(teamupPayload(draft), home);
  const edit = model({
    creatingTopic: false,
    editingPost: true,
    post: { post_number: 1, isbf_teamup: { show_on_home: home } },
  });
  restoreTeamup(edit);
  assert.equal(teamupPayload(edit), home);
}
const overridden = model({
  creatingTopic: false,
  editingPost: true,
  post: {
    post_number: 1,
    isbf_teamup_home: false,
    isbf_teamup: { show_on_home: true },
  },
});
restoreTeamup(overridden, { post: overridden.post });
assert.equal(
  teamupPayload(overridden),
  false,
  "Explicit false wins over stored true"
);
for (const excluded of [
  model({ categoryId: 43 }),
  model({ site: {} }),
  model({ creatingTopic: false, editingPost: true, post: { post_number: 2 } }),
  model({
    action: "reply",
    creatingTopic: false,
    topic: { category_id: 42 },
    isbf_anonymous: true,
  }),
]) {
  assert.equal(isTeamupComposer(excluded), false);
  assert.equal(teamupPayload(excluded), undefined);
}
const reply = model({
  action: "reply",
  creatingTopic: false,
  categoryId: 43,
  topic: { category: { id: 42 } },
  isbf_anonymous: true,
});
restoreTeamup(reply);
assert.equal(reply.isbf_anonymous, false);
assert.equal(teamupPayload(reply), undefined);
const user = { can_post_anonymously: true };
for (const action of ["createTopic", "reply"]) {
  for (const categoryId of [42, 43]) {
    const current = model({
      action,
      categoryId,
      topic: { category_id: categoryId },
    });
    assert.equal(
      anonymous.namespace.canPublishAnonymously(current, user, {}),
      categoryId === 43
    );
  }
}
const careersSite = {
  isbf_careers: { category_id: 44, enabled: true, version: 1 },
};
assert.equal(
  quick.namespace.isQuickPost(model({ categoryId: 44, site: careersSite })),
  false
);
assert.equal(
  quick.namespace.isQuickPost(model({ categoryId: 43, site: careersSite })),
  true
);
for (const topic of [{ category_id: 44 }, { category: { id: 44 } }]) {
  const careersReply = model({
    site: careersSite,
    action: "reply",
    creatingTopic: false,
    categoryId: 43,
    topic,
  });
  assert.equal(
    anonymous.namespace.canPublishAnonymously(careersReply, user, {}),
    false,
    "Careers reply uses its topic category even with a stale Composer category"
  );
}
assert.equal(
  anonymous.namespace.canPublishAnonymously(
    model({ site: careersSite, categoryId: 44 }),
    user,
    {}
  ),
  false
);
assert.equal(
  anonymous.namespace.canPublishAnonymously(
    model({
      site: careersSite,
      action: "reply",
      creatingTopic: false,
      categoryId: 44,
      topic: { category_id: 43 },
    }),
    user,
    {}
  ),
  true,
  "Other topic reply must not inherit a stale Careers category"
);
assert.equal(quick.namespace.isQuickPost(model()), false);
assert.equal(quick.namespace.isQuickPost(model({ categoryId: 43 })), true);

const registrations = {
  create: new Map(),
  update: new Map(),
  draft: new Map(),
  getters: new Map(),
  events: new Map(),
  outlets: [],
};
class Composer {
  static proto() {
    return this.prototype;
  }

  static serializeOnCreate(field, property) {
    registrations.create.set(field, property);
  }

  static serializeOnUpdate(field, property) {
    registrations.update.set(field, property);
  }

  static serializeToDraft(field, property) {
    registrations.draft.set(field, property);
  }

  clearState(...args) {
    this.nativeClearArgs = args;
    return "cleared";
  }

  open(options) {
    Object.assign(this, options);
    return Promise.resolve("opened");
  }

  save(...args) {
    this.nativeSaveArgs = args;
    return Promise.resolve("saved");
  }
}
const api = {
  addModelGetter(type, name, getter) {
    assert.equal(type, "composer");
    registrations.getters.set(name, getter);
  },
  addModelMethod(type, name, method) {
    assert.equal(type, "composer");
    Composer.prototype[name] = method;
  },
  onAppEvent(name, callback) {
    registrations.events.set(name, callback);
  },
  renderInOutlet(name, component) {
    registrations.outlets.push([name, component]);
  },
};
const extensions = await load(`${lib}composer-model-extensions.js`, {
  "discourse/models/composer": { default: Composer },
});
extensions.namespace.extendComposerMethod(
  api,
  "save",
  function (next, ...args) {
    this.otherExtensionRan = true;
    return next(...args);
  }
);
class Component {
  constructor(args = {}) {
    this.args = args;
  }
}
const component = await load(
  "javascripts/discourse/components/isbf-teamup-composer.gjs",
  {
    "@glimmer/component": { default: Component },
    "@ember/object": { action() {} },
    "virtual:theme": { themePrefix: (key) => key },
    "discourse-i18n": { i18n: (key) => key },
    "../lib/teamup": teamup,
    "./isbf-home-display-option": { default: class {} },
  }
);
await load("javascripts/discourse/api-initializers/isbf-teamup.gjs", {
  "virtual:theme": { themePrefix: (key) => key },
  "discourse/lib/api": { apiInitializer: (callback) => callback(api) },
  "discourse/models/composer": { default: Composer },
  "discourse-i18n": { i18n: (key) => key },
  "../components/isbf-teamup-composer": component,
  "../lib/feed-post-loader": {
    invalidateCookedPost: (id, hidden) => invalidations.push([id, hidden]),
  },
  "../lib/composer-model-extensions": extensions,
  "../lib/optional-topic-title": optional,
  "../lib/quick-post-scope": quick,
  "../lib/teamup": teamup,
});
let editedModel = model({
  creatingTopic: false,
  editingPost: true,
  post: { id: 91, post_number: 1 },
});
api.container = { lookup: () => ({ model: editedModel }) };
registrations.events.get("composer:edited-post")();
assert.deepEqual(
  invalidations,
  [[91, false]],
  "Group first-post edits invalidate the cooked body cache"
);
for (const excluded of [
  model({
    categoryId: 43,
    creatingTopic: false,
    editingPost: true,
    post: { id: 92, post_number: 1 },
  }),
  model({
    creatingTopic: false,
    editingPost: true,
    post: { id: 93, post_number: 2 },
  }),
]) {
  editedModel = excluded;
  registrations.events.get("composer:edited-post")();
}
assert.equal(invalidations.length, 1);
for (const kind of ["create", "update"]) {
  assert.equal(
    registrations[kind].get(TEAMUP_HOME_FIELD),
    "isbfTeamupHomePayload"
  );
}
assert.equal(registrations.draft.get(TEAMUP_HOME_FIELD), TEAMUP_HOME_FIELD);
assert.equal(registrations.outlets[0][0], "after-title-and-category");
const native = Object.assign(
  new Composer(),
  model({ alerts: [], dialog: { alert: (message) => message } })
);
assert.equal(
  await native.open({ isbf_anonymous: true, isbf_teamup_home: false }),
  "opened"
);
assert.equal(native.isbf_anonymous, false);
assert.equal(
  registrations.getters.get("isbfTeamupHomePayload").call(native),
  false
);
assert.equal(await native.save("native-argument"), "saved");
assert.equal(native.otherExtensionRan, true);
assert.deepEqual(native.nativeSaveArgs, ["native-argument"]);
for (const [title, body] of [
  ["", "body"],
  ["  ", "body"],
  ["校园动态 [isbf-untitled:12345678-1234-4234-8234-123456789abc]", "body"],
  ["title", ""],
  ["title", "  "],
]) {
  native.title = title;
  native.reply = body;
  native.nativeSaveArgs = null;
  await native.save();
  assert.equal(
    native.nativeSaveArgs,
    null,
    "Required title and body prevent native save"
  );
}
native.categoryId = 43;
assert.equal(await native.save("outside"), "saved");
assert.deepEqual(native.nativeSaveArgs, ["outside"]);
const changeCategory = registrations.events.get("composer:category-changed");
native.categoryId = 42;
native.isbf_anonymous = true;
native.title = "校园动态 [isbf-untitled:12345678-1234-4234-8234-123456789abc]";
changeCategory(native);
assert.equal(native.isbf_anonymous, false);
assert.equal(native.title, "");
native.categoryId = 43;
changeCategory(native);
assert.equal(native.isbf_teamup_home, null);
assert.equal(optional.namespace.isUntitledTopicTitle(native.title), true);
reply.isbf_anonymous = true;
changeCategory(reply);
assert.equal(reply.isbf_anonymous, false);
assert.equal(
  await native.open({
    action: "reply",
    creatingTopic: false,
    topic: { category_id: 42 },
    isbf_anonymous: true,
  }),
  "opened"
);
assert.equal(native.isbf_anonymous, false);
assert.equal(
  registrations.getters.get("isbfTeamupHomePayload").call(native),
  undefined
);
assert.equal(native.clearState("clear-argument"), "cleared");
assert.deepEqual(native.nativeClearArgs, ["clear-argument"]);
assert.equal(native.isbf_teamup_home, null);
const composerOption = new component.namespace.default({
  outletArgs: { model: fresh },
});
assert.equal(composerOption.visible, true);
for (const checked of [true, false]) {
  composerOption.changeHome({ target: { checked } });
  assert.equal(fresh.isbf_teamup_home, checked);
}
const label = read(
  "javascripts/discourse/components/isbf-home-display-option.gjs"
);
assert.match(
  label,
  /<label\b[\s\S]*<input\b[\s\S]*<span>\{\{@label\}\}<\/span>[\s\S]*<\/label>/
);
assert.match(label, /checked=\{\{this\.checked\}\}/);
assert.match(label, /\{\{on "change" @onChange\}\}/);
const HomeDisplay = (
  await load("javascripts/discourse/components/isbf-home-display-option.gjs", {
    "@glimmer/component": {
      default: class {
        constructor(_owner, args) {
          this.args = args;
        }
      },
    },
    "@ember/modifier": { on() {} },
  })
).namespace.default;
for (const value of [true, false, null, undefined, "false"]) {
  assert.equal(
    new HomeDisplay(null, { checked: value }).checked,
    value === true
  );
}

const recent = await load(`${lib}recent-discussions.js`, {
  "discourse/lib/ajax": {
    ajax: () => {
      throw new Error("Inject request");
    },
  },
  "./marketplace": marketplace,
  "./teamup": teamup,
  "./careers": careers,
});
const now = Date.parse("2026-10-12T12:00:00Z");
const topic = (id, extra = {}) => ({
  id,
  category_id: 2,
  created_at: new Date(now - 3600000).toISOString(),
  ...extra,
});
const legacy = topic(3, { category_id: 42 });
const visible = topic(5, {
  category_id: 42,
  isbf_teamup: { show_on_home: true },
});
const pages = [
  {
    topic_list: {
      topics: [
        topic(1, { category_id: 42, isbf_teamup: { show_on_home: false } }),
        topic(2, { category_id: 8, isbf_marketplace: { show_on_home: false } }),
        legacy,
      ],
      more_topics_url: "/filter.json?page=1",
    },
  },
  {
    topic_list: {
      topics: [
        topic(4, { isbf_teamup: { show_on_home: false } }),
        visible,
        topic(6),
        topic(7),
      ],
      more_topics_url: "/filter.json?page=2",
    },
  },
];
const calls = [];
const result = await recent.namespace.loadRecentDiscussions({
  site: {
    isbf_teamup: config,
    isbf_marketplace: { category_id: 8, version: 1, private_images: true },
  },
  now,
  request: async (url, options) => {
    calls.push({ url, options });
    assert.ok(pages.length);
    return pages.shift();
  },
});
assert.deepEqual(
  Array.from(result, (item) => item.id),
  [3, 5, 6, 7]
);
assert.equal(result[0], legacy, "Keep legacy Teamup topics with no flag");
assert.equal(result[1], visible, "Keep native topic identity");
assert.equal(calls.length, 2);
assert.equal(calls[0].url, "/filter.json");
assert.equal(calls[1].options.data.page, 1);
const initializer = read(
  "javascripts/discourse/api-initializers/isbf-teamup.gjs"
);
const feed = read("javascripts/discourse/components/isbf-teamup.gjs");
assert.doesNotMatch(
  initializer + feed,
  /TeamupUpload|UploadPreProcessor|UploadMarkdownResolver|isbf-teamup-card|ajax\(/
);
assert.match(feed, /<ISBFV2FeedCard/);
assert.match(feed, /this\.store\.findFiltered\("topicList"/);
assert.match(feed, /await list\.loadMore\(\)/);
const sharedStyles = read("stylesheets/workbench-topics.scss");
const mobileComposer = read("stylesheets/workbench-composer.scss");
const teamupStyles = read("stylesheets/teamup.scss");
assert.match(
  sharedStyles,
  /\.isbf-home-display-option\s*\{[^}]*gap:\s*8px;[^}]*min-height:\s*44px;/
);
assert.match(sharedStyles, /&:focus-within/);
assert.match(mobileComposer, /^@media \(width <= 600px\)\s*\{/);
assert.match(mobileComposer, /body:has\(\.isbf-v2-shell\)/);
assert.match(
  mobileComposer,
  /#reply-control\.open:has\(\.isbf-v2-composer\):is\(\s*:has\(\.isbf-marketplace-composer\),\s*:has\(\.isbf-teamup-composer\),\s*:has\(\.isbf-careers-composer\)\s*\)/
);
assert.match(mobileComposer, /\.title-input\s*\{[^}]*grid-row:\s*1;/);
assert.match(
  mobileComposer,
  /\.d-editor-textarea-wrapper\s*\{[^}]*grid-row:\s*2;/
);
assert.match(mobileComposer, /container:\s*isbf-workbench-composer \/ size;/);
assert.match(mobileComposer, /var\(--composer-vh, 1dvh\)/);
assert.match(
  mobileComposer,
  /padding-bottom:\s*calc\(56px \+ env\(safe-area-inset-bottom\)\);/
);
const [desktopStyles, mobileStyles] = teamupStyles.split(
  "@media (width <= 600px)"
);
assert.match(
  desktopStyles,
  /body:has\(\.isbf-v2-shell\)\s*#reply-control\.open:has\(\.isbf-teamup-composer\)/
);
assert.match(desktopStyles, /\.title-input\s*\{[^}]*grid-row:\s*1;/);
assert.match(
  desktopStyles,
  /\.category-input,\s*\.tags-input,\s*\.isbf-teamup-composer\s*\{[^}]*grid-row:\s*2;/
);
assert.match(
  mobileStyles,
  /\.category-input,\s*\.tags-input\s*\{[^}]*grid-row:\s*3;/
);
assert.match(mobileStyles, /\.isbf-teamup-composer\s*\{[^}]*grid-row:\s*4;/);
assert.match(
  mobileStyles,
  /grid-template-rows:\s*auto minmax\(0, 1fr\) auto auto;/
);
assert.match(
  mobileStyles,
  /grid-template-rows:\s*auto minmax\(44px, 1fr\) auto auto;/
);
assert.doesNotMatch(
  teamupStyles,
  /aspect-ratio|88px|isbf-marketplace-card|isbf-teamup-card/
);
console.log(
  "Teamup composer, scope, native feed, recent discussion and layout checks passed"
);
