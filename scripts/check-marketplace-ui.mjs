import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const context = vm.createContext({});
const module = new vm.SourceTextModule(
  read("javascripts/discourse/lib/marketplace.js"),
  { context },
);
await module.link(() => {});
await module.evaluate();
const {
  marketplaceDetailImages,
  marketplaceImageUrl,
  marketplaceConfig,
  marketplaceImageIds,
  marketplacePayload,
  marketplacePrice,
  marketplaceQuery,
  marketplaceUploadMarkdown,
  restoreMarketplace,
  isMarketplaceComposer,
  validMarketplacePrice,
} = module.namespace;
const config = { category_id: 42, private_images: true, version: 1 };
const id = "12345678-1234-4234-8234-123456789abc";
const model = (extra = {}) => ({
  site: { isbf_marketplace: config },
  categoryId: 42,
  creatingTopic: true,
  set(key, value) {
    this[key] = value;
  },
  ...extra,
});
assert.equal(marketplaceConfig({ isbf_marketplace: config }), config);
for (const bad of [
  undefined,
  {},
  { ...config, version: 2 },
  { ...config, private_images: false },
  { ...config, category_id: "42" },
]) {
  assert.equal(marketplaceConfig({ isbf_marketplace: bad }), null);
}
assert.deepEqual(JSON.parse(JSON.stringify(marketplaceQuery())), {
  q: "isbf-marketplace:all order:created",
});
for (const value of ["0", "0.00", "12.3", "12.34", " 2.50 "]) {
  assert.equal(validMarketplacePrice(value), true);
}
for (const value of [
  "",
  "-1",
  "1e3",
  "1.234",
  "01",
  "Infinity",
  "90071992547410",
]) {
  assert.equal(validMarketplacePrice(value), false);
}
assert.equal(marketplacePrice(1234), "¥12.34");
assert.equal(marketplacePrice(0), "¥0.00");
assert.equal(marketplacePrice(-1), null);
assert.equal(marketplacePrice("1234"), null);
assert.equal(
  JSON.stringify(marketplaceImageIds(JSON.stringify([id, id, "invalid"]))),
  JSON.stringify([id]),
);
assert.equal(JSON.stringify(marketplaceImageIds("{broken")), "[]");
const fresh = model({ isbf_anonymous: true });
restoreMarketplace(fresh);
assert.equal(fresh.isbf_marketplace_home, false);
assert.equal(fresh.isbf_anonymous, false);
assert.equal(fresh.isbf_marketplace_images, "[]");
const draft = model();
restoreMarketplace(draft, {
  isbf_marketplace_price: "12.30",
  isbf_marketplace_images: JSON.stringify([id]),
  isbf_marketplace_home: false,
});
assert.equal(marketplacePayload(draft, "isbf_marketplace_price"), "12.30");
assert.equal(marketplacePayload(draft, "isbf_marketplace_home"), false);
assert.equal(
  marketplacePayload(draft, "isbf_marketplace_images"),
  JSON.stringify([id]),
);
const edit = model({
  creatingTopic: false,
  editingPost: true,
  post: {
    post_number: 1,
    isbf_marketplace: {
      price_cents: 1234,
      images: [{ id }],
      show_on_home: true,
    },
  },
});
restoreMarketplace(edit);
assert.equal(edit.isbf_marketplace_price, "12.34");
assert.equal(edit.isbf_marketplace_home, true);
assert.equal(edit.isbf_marketplace_images, JSON.stringify([id]));
for (const excluded of [
  model({ categoryId: 43 }),
  model({ site: {} }),
  model({ creatingTopic: false }),
  model({ creatingTopic: false, editingPost: true, post: { post_number: 2 } }),
]) {
  assert.equal(isMarketplaceComposer(excluded), false);
  const before = { ...excluded };
  restoreMarketplace(excluded, { isbf_marketplace_price: "5" });
  assert.deepEqual(excluded, before);
  for (const field of [
    "isbf_marketplace_price",
    "isbf_marketplace_images",
    "isbf_marketplace_home",
  ]) {
    assert.equal(marketplacePayload(excluded, field), undefined);
  }
  assert.equal(
    marketplaceUploadMarkdown(
      { id, url: `/isbf/marketplace/images/${id}` },
      excluded,
    ),
    undefined,
  );
}
const upload = {
  id,
  url: `/isbf/marketplace/images/${id}`,
  original_filename: "[photo]\n.jpg",
};
assert.equal(
  marketplaceUploadMarkdown(upload, fresh),
  `![photo.jpg](${upload.url})`,
);
marketplaceUploadMarkdown(upload, fresh);
assert.equal(fresh.isbf_marketplace_images, JSON.stringify([id]));
assert.equal(
  marketplaceUploadMarkdown(
    { ...upload, url: "https://evil.example/image" },
    fresh,
  ),
  undefined,
);
const registrations = {
  create: new Map(),
  update: new Map(),
  draft: new Map(),
  getters: new Map(),
  methods: new Map(),
  outlets: [],
  text: null,
  transformers: new Map(),
};
const originals = {
  clearState() {
    this.clearCalled = true;
  },
  open(options) {
    this.categoryId = options.categoryId ?? this.categoryId;
    this.openCalled = true;
    return Promise.resolve("opened");
  },
  save() {
    this.saved = true;
    return Promise.resolve("saved");
  },
};
const Composer = {
  proto() {
    return { ...originals, ...Object.fromEntries(registrations.methods) };
  },
  serializeOnCreate(field, property) {
    registrations.create.set(field, property);
  },
  serializeOnUpdate(field, property) {
    registrations.update.set(field, property);
  },
  serializeToDraft(field, property) {
    registrations.draft.set(field, property);
  },
};
const api = {
  addModelGetter(type, name, getter) {
    assert.equal(type, "composer");
    registrations.getters.set(name, getter);
  },
  addModelMethod(type, name, method) {
    assert.equal(type, "composer");
    registrations.methods.set(name, method);
  },
  renderInOutlet(name, component) {
    registrations.outlets.push([name, component]);
  },
  customizeComposerText(options) {
    registrations.text = options;
  },
  registerValueTransformer(name, callback) {
    registrations.transformers.set(name, callback);
  },
  addComposerUploadPreProcessor() {},
  addComposerUploadMarkdownResolver() {},
};
const synthetic = (values) =>
  new vm.SyntheticModule(
    Object.keys(values),
    function () {
      for (const [key, value] of Object.entries(values)) {
        this.setExport(key, value);
      }
    },
    { context },
  );
const extensions = new vm.SourceTextModule(
  read("javascripts/discourse/lib/composer-model-extensions.js"),
  { context },
);
await extensions.link(() => synthetic({ default: Composer }));
await extensions.evaluate();
const initializerModule = new vm.SourceTextModule(
  read("javascripts/discourse/api-initializers/isbf-marketplace.gjs"),
  { context },
);
await initializerModule.link((specifier) => {
  if (specifier === "../lib/marketplace") {
    return module;
  }
  if (specifier === "../lib/composer-model-extensions") {
    return extensions;
  }
  if (specifier === "discourse/lib/api") {
    return synthetic({ apiInitializer: (callback) => callback(api) });
  }
  if (specifier === "discourse/models/composer") {
    return synthetic({ default: Composer });
  }
  if (specifier === "virtual:theme") {
    return synthetic({ themePrefix: (key) => key });
  }
  if (specifier === "discourse-i18n") {
    return synthetic({ i18n: (key) => key });
  }
  if (specifier.includes("isbf-marketplace-card")) {
    return synthetic({ ISBFMarketplacePrice: class {} });
  }
  return synthetic({ default: class {} });
});
await initializerModule.evaluate();
for (const field of module.namespace.MARKETPLACE_FIELDS) {
  assert.equal(
    registrations.create.get(field),
    registrations.update.get(field),
  );
  assert.equal(registrations.draft.get(field), field);
  assert.ok(registrations.getters.has(registrations.create.get(field)));
}
const nativeModel = model({
  title: "Book",
  reply: "Used book",
  setProperties(values) {
    Object.assign(this, values);
  },
  dialog: {
    alert(value) {
      return value;
    },
  },
});
registrations.methods.get("clearState").call(nativeModel);
assert.equal(nativeModel.clearCalled, true);
await registrations.methods.get("open").call(nativeModel, {
  categoryId: 42,
  isbf_marketplace_price: "5.20",
  isbf_marketplace_images: [id],
  isbf_marketplace_home: false,
});
assert.equal(nativeModel.openCalled, true);
const createPayload = Object.fromEntries(
  [...registrations.create].map(([field, property]) => [
    field,
    registrations.getters.get(property).call(nativeModel),
  ]),
);
assert.deepEqual(createPayload, {
  isbf_marketplace_price: "5.20",
  isbf_marketplace_images: JSON.stringify([id]),
  isbf_marketplace_home: false,
});
assert.equal(
  await registrations.methods.get("save").call(nativeModel),
  "saved",
);
assert.equal(nativeModel.saved, true);
nativeModel.saved = false;
nativeModel.isbf_marketplace_price = "5.234";
await registrations.methods.get("save").call(nativeModel);
assert.equal(nativeModel.saved, false);
nativeModel.categoryId = 43;
assert.equal(
  registrations.getters
    .get(registrations.create.get("isbf_marketplace_price"))
    .call(nativeModel),
  undefined,
);
assert.equal(
  await registrations.methods.get("save").call(nativeModel),
  "saved",
);
const initializer = read(
  "javascripts/discourse/api-initializers/isbf-marketplace.gjs",
);
for (const method of [
  "serializeOnCreate",
  "serializeOnUpdate",
  "serializeToDraft",
]) {
  assert.ok(initializer.includes(method));
}
assert.ok(initializer.includes('extendComposerMethod(api, "save"'));
assert.ok(!initializer.includes("modifyClass"));
assert.ok(
  initializer.includes(
    'api.renderInOutlet("post-metadata", ISBFMarketplacePrice)',
  ),
);
const feed = read("javascripts/discourse/components/isbf-marketplace.gjs");
assert.ok(feed.includes('this.store.findFiltered("topicList"'));
assert.ok(feed.includes('filter: "filter"'));
assert.ok(feed.includes("await list.loadMore()"));
assert.ok(feed.includes('list.set("loadingMore", false)'));
assert.ok(feed.includes("Composer.CREATE_TOPIC"));
assert.ok(feed.includes('this.appEvents.trigger("show-login")'));
assert.ok(!feed.includes("ajax("));
const processor = read("javascripts/discourse/lib/marketplace-upload.js");
assert.ok(processor.includes("configurePrivateUploadEndpoint"));
assert.ok(!processor.includes("setOptions"));
const card = read("javascripts/discourse/components/isbf-marketplace-card.gjs");
assert.ok(card.includes("plainText("));
assert.ok(card.includes("post.post_number !== 1"));
assert.ok(card.includes("href={{@topic.url}}"));
const styles = read("stylesheets/marketplace.scss");
assert.ok(styles.includes("112px"));
assert.ok(styles.includes("88px"));
assert.ok(styles.includes("env(safe-area-inset-bottom)"));

assert.equal(
  marketplaceImageUrl(`/isbf/marketplace/images/${id}/thumbnail`),
  `/isbf/marketplace/images/${id}/thumbnail`,
);
assert.equal(marketplaceImageUrl("https://evil.example/image"), null);
const imageMetadata = {
  images: [
    {
      id,
      url: `/isbf/marketplace/images/${id}`,
      thumbnail_url: `/isbf/marketplace/images/${id}/thumbnail`,
    },
  ],
};
assert.equal(marketplaceDetailImages(imageMetadata).length, 1);
assert.equal(
  marketplaceDetailImages(imageMetadata, [
    `https://forum.example/isbf/marketplace/images/${id}`,
  ]).length,
  0,
);
assert.equal(
  marketplaceDetailImages(imageMetadata, [
    `/isbf/marketplace/images/${id}/thumbnail`,
  ]).length,
  0,
);
assert.equal(
  marketplaceDetailImages({
    images: [{ id, url: "https://evil.example/image" }],
  }).length,
  0,
);
assert.ok(read("settings.yml").includes('default: "bag-shopping"'));
assert.ok(
  registrations.outlets.some(([name]) => name === "after-composer-title-input"),
);
assert.ok(
  !registrations.outlets.some(([name]) => name === "before-composer-fields"),
);
assert.equal(
  registrations.text.titlePlaceholder(model()),
  "isbf_v2.marketplace_name",
);
assert.equal(
  registrations.text.titlePlaceholder(model({ categoryId: 43 })),
  null,
);
const placeholder = registrations.transformers.get(
  "composer-editor-reply-placeholder",
);
assert.equal(
  placeholder({ value: "native", context: { model: { model: model() } } }),
  "isbf_v2.marketplace_description",
);
assert.equal(
  placeholder({
    value: "native",
    context: { model: { model: model({ categoryId: 43 }) } },
  }),
  "native",
);
const composerSource = read(
  "javascripts/discourse/components/isbf-marketplace-composer.gjs",
);
assert.ok(composerSource.includes("this.args.outletArgs?.composer"));
assert.ok(styles.includes("#reply-control:has(.isbf-marketplace-composer)"));
assert.ok(styles.includes(".title-and-category > .title-input"));
assert.ok(styles.includes("flex-basis: 100%"));
assert.ok(feed.includes("this.config?.publishing_enabled !== false"));
const capabilityGetter = feed.slice(
  feed.indexOf("  get canCreate()"),
  feed.indexOf("  @action", feed.indexOf("  get canCreate()")),
);
const Capability = vm.runInContext(
  `(class Capability { ${capabilityGetter} })`,
  context,
);
const capability = new Capability();
capability.config = config;
capability.currentUser = { id: 1 };
capability.site = { categories: [{ id: 42, canCreateTopic: true }] };
assert.equal(capability.canCreate, true);
capability.config = { ...config, publishing_enabled: false };
assert.equal(capability.canCreate, false);
capability.config = config;
capability.site.categories[0].canCreateTopic = false;
assert.equal(capability.canCreate, false);
capability.site.categories[0].canCreateTopic = true;
capability.currentUser = null;
assert.equal(capability.canCreate, false);
console.log("Marketplace source and VM checks passed");
