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
const helper = new vm.SourceTextModule(
  read("javascripts/discourse/lib/careers.js"),
  { context }
);
await helper.link(() => {});
await helper.evaluate();
const {
  CAREERS_FIELDS,
  careersConfig,
  careersPayload,
  careersQuery,
  careersImageUrl,
  isCareersCategory,
  isCareersComposer,
  restoreCareers,
  validCareersSalary,
} = helper.namespace;
const config = {
  enabled: true,
  category_id: 42,
  version: 1,
  salary_max_length: 120,
};
const model = (extra = {}) => ({
  site: { isbf_careers: config },
  categoryId: 42,
  creatingTopic: true,
  set(key, value) {
    this[key] = value;
  },
  setProperties(values) {
    Object.assign(this, values);
  },
  ...extra,
});
assert.equal(careersConfig({ isbf_careers: config }), config);
for (const bad of [
  undefined,
  {},
  { ...config, enabled: false },
  { ...config, category_id: "42" },
  { ...config, version: 2 },
]) {
  assert.equal(careersConfig({ isbf_careers: bad }), null);
}
assert.equal(careersQuery().q, "isbf-careers:all order:created");
for (const value of [
  null,
  undefined,
  "",
  "   ",
  "面议",
  "  200元/天  ",
  "😀".repeat(120),
]) {
  assert.equal(validCareersSalary(value), true);
}
for (const value of ["😀".repeat(121), "中".repeat(121), 100, {}]) {
  assert.equal(validCareersSalary(value), false);
}
for (const invalid of [
  "line\nline",
  "tab\ttext",
  "\n面议",
  "面议\r",
  "\u0000",
  "\u007f",
  "\u0085",
  "\ud800",
]) {
  assert.equal(
    validCareersSalary(invalid),
    false,
    "Reject controls before trimming and malformed Unicode"
  );
}
const spacedSalary = model({ isbf_careers_salary: "\u3000面议\u3000" });
assert.equal(careersPayload(spacedSalary, CAREERS_FIELDS[0]), "面议");
spacedSalary.isbf_careers_salary = "\ufeff面议\ufeff";
assert.equal(
  careersPayload(spacedSalary, CAREERS_FIELDS[0]),
  "\ufeff面议\ufeff",
  "BOM is not Ruby POSIX whitespace"
);
for (const topic of [
  { category_id: 42 },
  { category_id: "42" },
  { category: { id: 42 } },
]) {
  const reply = model({
    action: "reply",
    creatingTopic: false,
    categoryId: 43,
    topic,
  });
  assert.equal(
    isCareersCategory(reply),
    true,
    "Reply category comes from the target topic"
  );
  assert.equal(
    isCareersComposer(reply),
    false,
    "Replies must not serialize listing fields"
  );
  for (const field of CAREERS_FIELDS) {
    assert.equal(careersPayload(reply, field), undefined);
  }
  reply.isbf_anonymous = true;
  restoreCareers(reply);
  assert.equal(reply.isbf_anonymous, false);
  assert.equal(reply.isbf_careers_salary, undefined);
}
for (const topic of [{ category_id: 43 }, { category: { id: 43 } }, {}]) {
  assert.equal(
    isCareersCategory(model({ action: "reply", creatingTopic: false, topic })),
    false,
    "Stale Composer category must not classify another topic reply"
  );
}
assert.equal(
  isCareersCategory(model({ categoryId: 43, topic: { category_id: 42 } })),
  false,
  "Create scope follows its selected category"
);
const fresh = model({ isbf_anonymous: true });
restoreCareers(fresh);
assert.equal(fresh.isbf_careers_salary, "");
assert.equal(fresh.isbf_careers_home, false);
assert.equal(fresh.isbf_anonymous, false);
const edit = model({
  creatingTopic: false,
  editingPost: true,
  post: {
    post_number: 1,
    isbf_careers: { salary: "面议", show_on_home: true },
  },
});
restoreCareers(edit);
assert.equal(edit.isbf_careers_salary, "面议");
assert.equal(edit.isbf_careers_home, true);
restoreCareers(edit, { isbf_careers_salary: "", isbf_careers_home: false });
assert.equal(
  careersPayload(edit, CAREERS_FIELDS[0]),
  "",
  "Empty draft must clear old salary"
);
assert.equal(careersPayload(edit, CAREERS_FIELDS[1]), false);
const draft = model();
restoreCareers(draft, {
  isbf_careers_salary: "  200元/天  ",
  isbf_careers_home: true,
});
assert.equal(careersPayload(draft, CAREERS_FIELDS[0]), "200元/天");
assert.equal(careersPayload(draft, CAREERS_FIELDS[1]), true);
for (const excluded of [
  model({ categoryId: 43 }),
  model({ site: {} }),
  model({ creatingTopic: false }),
  model({ creatingTopic: false, editingPost: true, post: { post_number: 2 } }),
]) {
  assert.equal(isCareersComposer(excluded), false);
  const before = { ...excluded };
  restoreCareers(excluded, { isbf_careers_salary: "wrong" });
  assert.deepEqual(
    excluded,
    isCareersCategory(excluded) ? { ...before, isbf_anonymous: false } : before
  );
  for (const field of CAREERS_FIELDS) {
    assert.equal(careersPayload(excluded, field), undefined);
  }
}
for (const url of [
  "/uploads/default/a.png",
  "https://cdn.example/a.png",
  "http://forum.example/a.png",
]) {
  assert.equal(careersImageUrl(url), url);
}
for (const url of [
  ["javascript", ":alert(1)"].join(""),
  "data:image/png;base64,abc",
  "//evil.example/a",
  "/\\evil.example/a",
  "",
  null,
]) {
  assert.equal(careersImageUrl(url), null);
}

const registrations = {
  create: new Map(),
  update: new Map(),
  draft: new Map(),
  getters: new Map(),
  methods: new Map(),
  events: new Map(),
  outlets: [],
};
let activeModel;
let invalidated;
const Composer = {
  CREATE_TOPIC: "createTopic",
  NEW_TOPIC_KEY: "new_topic",
  proto: () => ({
    clearState() {
      this.cleared = true;
    },
    open(options) {
      this.categoryId = options.categoryId ?? this.categoryId;
      return Promise.resolve("opened");
    },
    save() {
      this.saved = true;
      return Promise.resolve("saved");
    },
    ...Object.fromEntries(registrations.methods),
  }),
  serializeOnCreate: (field, property) =>
    registrations.create.set(field, property),
  serializeOnUpdate: (field, property) =>
    registrations.update.set(field, property),
  serializeToDraft: (field, property) =>
    registrations.draft.set(field, property),
};
const api = {
  container: { lookup: () => ({ model: activeModel }) },
  addModelGetter: (_type, name, getter) =>
    registrations.getters.set(name, getter),
  addModelMethod: (_type, name, method) =>
    registrations.methods.set(name, method),
  onAppEvent: (name, callback) => registrations.events.set(name, callback),
  renderInOutlet: (name) => registrations.outlets.push(name),
  renderAfterWrapperOutlet: (name) =>
    registrations.outlets.push(`${name}__after`),
  customizeComposerText() {},
  registerValueTransformer() {},
};
const extensions = new vm.SourceTextModule(
  read("javascripts/discourse/lib/composer-model-extensions.js"),
  { context }
);
await extensions.link(() => synthetic({ default: Composer }));
await extensions.evaluate();
class Component {
  constructor(_owner, args = {}) {
    this.args = args;
  }

  willDestroy() {}
}
let pendingCooked;
const stubs = {
  "@glimmer/component": { default: Component },
  "@glimmer/tracking": { tracked() {} },
  "@ember/object": { action() {} },
  "@ember/service": { service() {} },
  "@ember/modifier": { on() {} },
  "@ember/render-modifiers/modifiers/did-insert": { default() {} },
  "@ember/render-modifiers/modifiers/did-update": { default() {} },
  "@ember/runloop": { scheduleOnce() {} },
  "virtual:theme": { themePrefix: (key) => key },
  "discourse-i18n": { i18n: (key) => key },
  "discourse/models/composer": { default: Composer },
  "../lib/feed-post-loader": {
    loadCookedPost: () => pendingCooked,
    invalidateCookedPost: (...args) => {
      invalidated = args;
    },
  },
  "../lib/optional-topic-title": {
    isUntitledTopicTitle: (title) => title?.startsWith("[isbf-untitled:"),
    prepareOptionalTopicTitle: (item) => {
      item.prepared = true;
    },
  },
  "../lib/quick-post-scope": { isQuickPost: (item) => item.categoryId === 43 },
  "../lib/post-card-helpers": { plainText: (value) => value ?? "" },
  "../lib/post-preview": {
    postPreview: (cooked) => ({ images: cooked ? [{ src: cooked }] : [] }),
  },
};
const transform = (source) =>
  source
    .replace(/<template>[\s\S]*?<\/template>/g, "")
    .replace(/@(action|service|tracked)\s+/g, "");
async function loadComponent(name) {
  const result = new vm.SourceTextModule(
    transform(read(`javascripts/discourse/components/${name}.gjs`)),
    { context }
  );
  await result.link((specifier) => {
    if (specifier === "../lib/careers") {
      return helper;
    }
    if (stubs[specifier]) {
      return synthetic(stubs[specifier]);
    }
    if (specifier.startsWith("./isbf-")) {
      return synthetic({ default: Component });
    }
    throw new Error(`Unexpected import: ${specifier}`);
  });
  await result.evaluate();
  return result.namespace;
}
const initializerSource = read(
  "javascripts/discourse/api-initializers/isbf-careers.gjs"
);
const initializer = new vm.SourceTextModule(initializerSource, { context });
await initializer.link((specifier) => {
  if (specifier === "../lib/careers") {
    return helper;
  }
  if (specifier === "../lib/composer-model-extensions") {
    return extensions;
  }
  if (specifier === "discourse/lib/api") {
    return synthetic({ apiInitializer: (callback) => callback(api) });
  }
  if (specifier.includes("isbf-careers-card")) {
    return synthetic({ ISBFCareersSalary: Component });
  }
  if (specifier.includes("isbf-careers-composer")) {
    return synthetic({ default: Component, ISBFCareersHome: Component });
  }
  if (stubs[specifier]) {
    return synthetic(stubs[specifier]);
  }
  throw new Error(`Unexpected initializer import: ${specifier}`);
});
await initializer.evaluate();
for (const field of CAREERS_FIELDS) {
  assert.equal(
    registrations.create.get(field),
    registrations.update.get(field)
  );
  assert.equal(registrations.draft.get(field), field);
  assert.ok(registrations.getters.has(registrations.create.get(field)));
}
activeModel = model({
  title: "职位",
  reply: "说明",
  dialog: { alert: (value) => value },
});
await registrations.methods
  .get("open")
  .call(activeModel, { isbf_careers_salary: "面议", isbf_careers_home: false });
assert.equal(activeModel.isbf_careers_salary, "面议");
assert.equal(
  await registrations.methods.get("save").call(activeModel),
  "saved"
);
activeModel.saved = false;
activeModel.isbf_careers_salary = "😀".repeat(121);
await registrations.methods.get("save").call(activeModel);
assert.equal(activeModel.saved, false);
activeModel.isbf_careers_salary = "";
assert.equal(
  await registrations.methods.get("save").call(activeModel),
  "saved"
);
for (const [title, reply] of [
  ["", "说明"],
  ["职位", ""],
  ["[isbf-untitled:test]", "说明"],
]) {
  activeModel.setProperties({ title, reply, saved: false });
  await registrations.methods.get("save").call(activeModel);
  assert.equal(activeModel.saved, false);
}
activeModel.title = "[isbf-untitled:test]";
registrations.events.get("composer:category-changed")(activeModel);
assert.equal(activeModel.title, "");
activeModel.categoryId = 43;
registrations.events.get("composer:category-changed")(activeModel);
assert.equal(activeModel.isbf_careers_salary, null);
assert.equal(activeModel.isbf_careers_home, null);
assert.equal(activeModel.prepared, true);
activeModel = edit;
activeModel.post.id = 99;
registrations.events.get("composer:edited-post")();
assert.deepEqual(invalidated, [99, false]);
assert.ok(registrations.outlets.includes("post-metadata__after"));
assert.ok(!registrations.outlets.includes("post-metadata"));
assert.doesNotMatch(
  initializerSource,
  /addComposerUpload|marketplace-upload|isbf_careers_images/
);

const { default: ComposerFields, ISBFCareersHome } = await loadComponent(
  "isbf-careers-composer"
);
for (const outletKey of ["model", "composer"]) {
  const item = model();
  restoreCareers(item);
  const args = { outletArgs: { [outletKey]: item } };
  const fields = new ComposerFields(undefined, args);
  const home = new ISBFCareersHome(undefined, args);
  assert.equal(fields.visible, true);
  assert.equal(home.visible, true);
  fields.changeSalary({ target: { value: "面议" } });
  assert.equal(careersPayload(item, CAREERS_FIELDS[0]), "面议");
  for (const checked of [true, false]) {
    home.changeHome({ target: { checked, value: "on" } });
    assert.equal(careersPayload(item, CAREERS_FIELDS[1]), checked);
  }
  item.categoryId = 43;
  assert.equal(fields.visible, false);
  assert.equal(home.visible, false);
}

const { default: Page } = await loadComponent("isbf-careers");
const page = new Page();
page.site = {
  isbf_careers: config,
  categories: [{ id: 42, canCreateTopic: true }],
};
page.currentUser = { id: 7 };
assert.equal(page.canCreate, true);
page.site.categories[0].canCreateTopic = false;
assert.equal(page.canCreate, false);
page.site.categories[0].canCreateTopic = true;
config.publishing_enabled = false;
assert.equal(page.canCreate, false);
delete config.publishing_enabled;
let resolveList;
page.store = {
  findFiltered: (_type, options) => {
    assert.equal(options.filter, "filter");
    assert.equal(options.params.q, "isbf-careers:all order:created");
    return new Promise((resolve) => {
      resolveList = resolve;
    });
  },
};
let loading = page.load();
page.currentUser = { id: 8 };
resolveList({ topics: [{ id: 1 }] });
await loading;
assert.equal(page.topicList, null, "Old user response must be ignored");
page.loading = false;
loading = page.load();
page.isDestroying = true;
resolveList({ topics: [{ id: 2 }] });
await loading;
assert.equal(page.topicList, null, "Destroyed page must ignore list response");
page.isDestroying = false;
page.loading = false;
loading = page.load();
const list = {
  topics: [{ id: 3 }],
  canLoadMore: true,
  set(key, value) {
    this[key] = value;
  },
  loadMore() {
    throw new Error("offline");
  },
};
resolveList(list);
await loading;
assert.equal(page.topics[0].id, 3);
await page.loadMore();
assert.equal(page.error, true);
assert.equal(list.loadingMore, false);
list.loadMore = async () => {
  list.topics.push({ id: 4 });
};
await page.retry();
assert.equal(page.error, false);
assert.equal(page.topics[1].id, 4);
page.currentUser = null;
assert.equal(page.canCreate, false);

const { default: Card, ISBFCareersSalary } =
  await loadComponent("isbf-careers-card");
const topic = { first_post_id: 99, isbf_careers: { salary: "面议" } };
const card = new Card(undefined, { topic });
card.currentUser = { id: 7 };
card.args.topic.image_url = "/uploads/default/native.png";
await card.loadImage();
assert.equal(card.image, "/uploads/default/native.png");
delete card.args.topic.image_url;
let resolveCooked;
pendingCooked = new Promise((resolve) => {
  resolveCooked = resolve;
});
let preview = card.loadImage();
card.args.topic = { first_post_id: 100 };
resolveCooked("https://forum.example/old.png");
await preview;
assert.equal(card.image, null, "Reused card must ignore old topic cover");
pendingCooked = Promise.resolve("https://forum.example/current.png");
await card.loadImage();
assert.equal(card.image, "https://forum.example/current.png");
card.currentUser = { id: 8 };
assert.equal(card.image, null, "Cover fallback belongs to requesting user");
pendingCooked = new Promise((resolve) => {
  resolveCooked = resolve;
});
preview = card.loadImage();
card.willDestroy();
resolveCooked("https://forum.example/destroyed.png");
await preview;
assert.equal(card.image, null);
const salary = new ISBFCareersSalary(undefined, {
  outletArgs: {
    post: { post_number: 1, isbf_careers: { salary: "<b>面议</b>" } },
  },
});
assert.equal(salary.salary, "<b>面议</b>");
salary.args.outletArgs.post.post_number = 2;
assert.equal(salary.salary, "");
const shared = read(
  "javascripts/discourse/components/isbf-workbench-listing-card.gjs"
);
assert.match(
  shared,
  /class="lightbox isbf-marketplace-card__image"\s+href=\{\{@imageUrl\}\}/
);
assert.match(
  shared,
  /class="isbf-marketplace-card__content" href=\{\{@topic.url\}\}/
);
assert.match(shared, /\{\{yield\}\}/);
assert.doesNotMatch(shared, /onclick|stopPropagation|preventDefault/);
const careers = read("javascripts/discourse/components/isbf-careers-card.gjs");
assert.match(careers, /loadCookedPost\(postId\)/);
assert.doesNotMatch(careers, /ajax\(|trustHTML|htmlSafe/);
assert.match(careers, />\{\{this.salary\}\}<\/span>/);
assert.match(
  read("javascripts/discourse/components/isbf-marketplace-card.gjs"),
  /<ISBFWorkbenchListingCard/
);
assert.doesNotMatch(
  read("javascripts/discourse/components/isbf-careers-composer.gjs"),
  /required|inputmode="decimal"/
);
assert.doesNotMatch(
  read("javascripts/discourse/components/isbf-careers-composer.gjs"),
  /maxlength/i,
  "Native maxlength counts UTF-16 units and must not truncate 120 astral characters"
);
process.stdout.write(
  "Careers helper, Composer, permission, pagination and stale request checks passed\n"
);
