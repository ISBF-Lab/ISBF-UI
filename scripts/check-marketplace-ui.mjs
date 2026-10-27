import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const context = vm.createContext({});
const module = new vm.SourceTextModule(
  read("javascripts/discourse/lib/marketplace.js"),
  { context }
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
  JSON.stringify([id])
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
  JSON.stringify([id])
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
      excluded
    ),
    undefined
  );
}
const upload = {
  id,
  url: `/isbf/marketplace/images/${id}`,
  original_filename: "[photo]\n.jpg",
};
assert.equal(
  marketplaceUploadMarkdown(upload, fresh),
  `![photo.jpg](${upload.url})`
);
marketplaceUploadMarkdown(upload, fresh);
assert.equal(fresh.isbf_marketplace_images, JSON.stringify([id]));
assert.equal(
  marketplaceUploadMarkdown(
    { ...upload, url: "https://evil.example/image" },
    fresh
  ),
  undefined
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
  renderAfterWrapperOutlet(name, component) {
    this.renderInOutlet(`${name}__after`, component);
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
    { context }
  );
const extensions = new vm.SourceTextModule(
  read("javascripts/discourse/lib/composer-model-extensions.js"),
  { context }
);
await extensions.link(() => synthetic({ default: Composer }));
await extensions.evaluate();
const initializerModule = new vm.SourceTextModule(
  read("javascripts/discourse/api-initializers/isbf-marketplace.gjs"),
  { context }
);
class ComposerOutlet {}
class HomeOutlet {}
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
  if (specifier.includes("isbf-marketplace-composer")) {
    return synthetic({
      default: ComposerOutlet,
      ISBFMarketplaceHome: HomeOutlet,
    });
  }
  return synthetic({ default: class {} });
});
await initializerModule.evaluate();
for (const field of module.namespace.MARKETPLACE_FIELDS) {
  assert.equal(
    registrations.create.get(field),
    registrations.update.get(field)
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
  ])
);
assert.deepEqual(createPayload, {
  isbf_marketplace_price: "5.20",
  isbf_marketplace_images: JSON.stringify([id]),
  isbf_marketplace_home: false,
});
assert.equal(
  await registrations.methods.get("save").call(nativeModel),
  "saved"
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
  undefined
);
assert.equal(
  await registrations.methods.get("save").call(nativeModel),
  "saved"
);
const initializer = read(
  "javascripts/discourse/api-initializers/isbf-marketplace.gjs"
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
    'api.renderAfterWrapperOutlet("post-metadata", ISBFMarketplacePrice)'
  )
);
assert.ok(
  registrations.outlets.some(([name]) => name === "post-metadata__after")
);
assert.ok(!registrations.outlets.some(([name]) => name === "post-metadata"));
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
const sharedCard = read(
  "javascripts/discourse/components/isbf-workbench-listing-card.gjs"
);
assert.ok(sharedCard.includes("href={{@topic.url}}"));
assert.match(
  card,
  /<ISBFWorkbenchListingCard\s+@description=\{\{this.description\}\}\s+@image=\{\{this.image\}\}\s+@imageUrl=\{\{this.imageUrl\}\}\s+@topic=\{\{@topic\}\}/
);
assert.match(
  card,
  /<ISBFMarketplacePrice @metadata=\{\{@topic.isbf_marketplace\}\} \/>/
);
assert.match(sharedCard, /\{\{yield\}\}/);
assert.match(
  card,
  /import contentImages from "\.\.\/modifiers\/content-images";/
);
assert.match(
  sharedCard,
  /<article class="isbf-marketplace-card" \.\.\.attributes \{\{contentImages\}\}>/
);
assert.match(
  sharedCard,
  /class="lightbox isbf-marketplace-card__image"\s+href=\{\{@imageUrl\}\}/
);
assert.match(
  sharedCard,
  /<a class="isbf-marketplace-card__content" href=\{\{@topic.url\}\}>/
);
assert.match(
  card,
  /class="isbf-marketplace-detail-images" \{\{contentImages\}\}/
);
assert.match(card, /class="lightbox"\s+href=\{\{image.url\}\}/);
assert.match(card, /src=\{\{image.thumbnail\}\}/);
assert.match(
  card,
  /aria-label=\{\{i18n \(themePrefix "isbf_v2.preview_image"\)\}\}/
);
assert.doesNotMatch(
  `${card}\n${sharedCard}`,
  /href=\{\{(?:this.image|image.thumbnail)\}\}|onclick=|stopPropagation|preventDefault/
);
let anchorDepth = 0;
for (const anchorTag of `${card}\n${sharedCard}`.matchAll(/<a\b|<\/a>/g)) {
  anchorDepth += anchorTag[0] === "</a>" ? -1 : 1;
  assert.ok(
    anchorDepth >= 0 && anchorDepth <= 1,
    "preview and topic links must not nest"
  );
}
assert.equal(anchorDepth, 0);
const cardComponentModule = new vm.SourceTextModule(
  card.replace(/<template>[\s\S]*?<\/template>/g, ""),
  { context }
);
await cardComponentModule.link((specifier) => {
  if (specifier === "../lib/marketplace") {
    return module;
  }
  return synthetic({
    default: class {
      constructor(args = {}) {
        this.args = args;
      }
    },
    themePrefix: (key) => key,
    i18n: (key) => key,
    plainText: (value) => value,
  });
});
await cardComponentModule.evaluate();
const MarketplaceCard = cardComponentModule.namespace.default;
const coverUrl = `/isbf/marketplace/images/${id}`;
const coverCard = new MarketplaceCard({
  topic: {
    url: "/t/used-book/123",
    excerpt: "Book description",
    isbf_marketplace: {
      price_cents: 1234,
      images: [{ url: coverUrl, thumbnail_url: `${coverUrl}/thumbnail` }],
    },
  },
});
assert.equal(
  coverCard.imageUrl,
  coverUrl,
  "preview targets the original image"
);
assert.equal(
  coverCard.image,
  `${coverUrl}/thumbnail`,
  "cover displays the thumbnail"
);
assert.equal(coverCard.args.topic.url, "/t/used-book/123");
assert.equal(coverCard.description, "Book description");
coverCard.args.topic.isbf_marketplace.images[0].thumbnail_url =
  "https://evil.example/image";
assert.equal(
  coverCard.image,
  coverUrl,
  "unsafe thumbnails fall back to the safe original"
);
coverCard.args.topic.isbf_marketplace.images[0].url = "javascript:alert(1)";
assert.equal(coverCard.imageUrl, null);
assert.equal(coverCard.image, null);
coverCard.args.topic.isbf_marketplace.images = [];
assert.equal(coverCard.imageUrl, null);
assert.equal(coverCard.image, null);
const detailPrice = new cardComponentModule.namespace.ISBFMarketplacePrice({
  outletArgs: {
    post: { post_number: 1, isbf_marketplace: { price_cents: 1234 } },
  },
});
assert.equal(detailPrice.price, "¥12.34");
detailPrice.args.outletArgs.post.post_number = 2;
assert.equal(detailPrice.price, null);
assert.equal(detailPrice.images.length, 0);

const sharedMobileStyles = read("stylesheets/workbench-composer.scss");
const styles = [
  read("stylesheets/marketplace.scss"),
  read("stylesheets/workbench-topics.scss"),
  sharedMobileStyles,
].join("\n");
assert.ok(styles.includes("112px"));
assert.ok(styles.includes("88px"));
assert.ok(styles.includes("env(safe-area-inset-bottom)"));

assert.equal(
  marketplaceImageUrl(`/isbf/marketplace/images/${id}/thumbnail`),
  `/isbf/marketplace/images/${id}/thumbnail`
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
  0
);
assert.equal(
  marketplaceDetailImages(imageMetadata, [
    `/isbf/marketplace/images/${id}/thumbnail`,
  ]).length,
  0
);
assert.equal(
  marketplaceDetailImages({
    images: [{ id, url: "https://evil.example/image" }],
  }).length,
  0
);
assert.ok(read("settings.yml").includes('default: "bag-shopping"'));
assert.ok(
  registrations.outlets.some(
    ([name, component]) =>
      name === "after-title-and-category" && component === ComposerOutlet
  )
);
assert.ok(
  !registrations.outlets.some(([name]) => name === "before-composer-fields")
);
assert.ok(
  !registrations.outlets.some(([name]) => name === "after-composer-title-input")
);
assert.equal(
  registrations.text.titlePlaceholder(model()),
  "isbf_v2.marketplace_name"
);
assert.equal(
  registrations.text.titlePlaceholder(model({ categoryId: 43 })),
  null
);
const placeholder = registrations.transformers.get(
  "composer-editor-reply-placeholder"
);
assert.equal(
  placeholder({ value: "native", context: { model: { model: model() } } }),
  "isbf_v2.marketplace_description"
);
assert.equal(
  placeholder({
    value: "native",
    context: { model: { model: model({ categoryId: 43 }) } },
  }),
  "native"
);
const composerSource = read(
  "javascripts/discourse/components/isbf-marketplace-composer.gjs"
);
assert.ok(composerSource.includes("this.args.outletArgs?.composer"));
assert.ok(composerSource.includes("this.args.outletArgs?.model"));
assert.ok(!composerSource.includes("marketplace_composer_hint"));
assert.ok(!composerSource.includes("isbf_anonymous"));
assert.ok(
  registrations.outlets.some(
    ([name, component]) =>
      name === "after-title-and-category" && component === HomeOutlet
  )
);
const composerModule = new vm.SourceTextModule(
  composerSource
    .replace(/<template>[\s\S]*?<\/template>/g, "")
    .replace(/@action\s+/g, ""),
  { context }
);
await composerModule.link((specifier) => {
  if (specifier === "./isbf-home-display-option") {
    return synthetic({ default: class {} });
  }
  if (specifier === "../lib/marketplace") {
    return module;
  }
  if (specifier === "@glimmer/component") {
    return synthetic({
      default: class {
        constructor(_owner, args) {
          this.args = args;
        }
      },
    });
  }
  if (specifier === "@ember/modifier") {
    return synthetic({ on() {} });
  }
  if (specifier === "@ember/object") {
    return synthetic({ action() {} });
  }
  if (specifier === "virtual:theme") {
    return synthetic({ themePrefix: (key) => key });
  }
  if (specifier === "discourse-i18n") {
    return synthetic({ i18n: (key) => key });
  }
  throw new Error(`Unexpected composer import: ${specifier}`);
});
await composerModule.evaluate();
const { default: MarketplaceComposer, ISBFMarketplaceHome } =
  composerModule.namespace;
assert.equal(typeof ISBFMarketplaceHome, "function");
assert.equal(new MarketplaceComposer(undefined, {}).visible, false);
assert.equal(new ISBFMarketplaceHome(undefined, {}).visible, false);
for (const outletArgument of ["model", "composer"]) {
  const composerModel = model();
  restoreMarketplace(composerModel);
  const args = { outletArgs: { [outletArgument]: composerModel } };
  const priceComponent = new MarketplaceComposer(undefined, args);
  const homeComponent = new ISBFMarketplaceHome(undefined, args);
  assert.equal(priceComponent.model, composerModel);
  assert.equal(homeComponent.model, composerModel);
  assert.equal(priceComponent.visible, true);
  assert.equal(homeComponent.visible, true);
  assert.equal(composerModel.isbf_marketplace_home, false);
  priceComponent.changePrice({ target: { value: "8.50" } });
  assert.equal(composerModel.isbf_marketplace_price, "8.50");
  for (const checked of [true, false]) {
    homeComponent.changeHome({ target: { checked, value: "on" } });
    assert.equal(composerModel.isbf_marketplace_home, checked);
    assert.equal(typeof composerModel.isbf_marketplace_home, "boolean");
    const restoredDraft = model();
    restoreMarketplace(restoredDraft, {
      isbf_marketplace_home: marketplacePayload(
        composerModel,
        "isbf_marketplace_home"
      ),
    });
    assert.equal(restoredDraft.isbf_marketplace_home, checked);
  }
  composerModel.categoryId = 43;
  assert.equal(priceComponent.visible, false);
  assert.equal(homeComponent.visible, false);
}
// Exercise the cancellation component with the real scope helpers, without rendering.
context.document = { querySelector: () => ({}) };
const careersModule = new vm.SourceTextModule(
  read("javascripts/discourse/lib/careers.js"),
  { context }
);
await careersModule.link(() => {});
await careersModule.evaluate();
const quickPostModule = new vm.SourceTextModule(
  read("javascripts/discourse/lib/quick-post-scope.js"),
  { context }
);
await quickPostModule.link((specifier) => {
  if (specifier === "./careers") {
    return careersModule;
  }
  if (specifier === "./teamup") {
    return synthetic({ isTeamupCategory: () => false });
  }
  if (specifier === "./marketplace") {
    return module;
  }
  if (specifier === "virtual:theme") {
    return synthetic({ settings: { calendar_category_id: 51 } });
  }
  throw new Error(`Unexpected quick-post import: ${specifier}`);
});
await quickPostModule.evaluate();
const teamupModule = new vm.SourceTextModule(
  read("javascripts/discourse/lib/teamup.js"),
  { context }
);
await teamupModule.link(() => {});
await teamupModule.evaluate();
const cancelSource = read(
  "javascripts/discourse/components/isbf-v2-composer-cancel.gjs"
);
const cancelModule = new vm.SourceTextModule(
  cancelSource
    .replace(/<template>[\s\S]*?<\/template>/g, "")
    .replace(/@action\s+/g, "")
    .replace(/@service\s+/g, ""),
  { context }
);
await cancelModule.link((specifier) => {
  if (specifier === "../lib/careers") {
    return careersModule;
  }
  if (specifier === "../lib/teamup") {
    return teamupModule;
  }
  if (specifier === "../lib/marketplace") {
    return module;
  }
  if (specifier === "../lib/quick-post-scope") {
    return quickPostModule;
  }
  if (specifier === "@glimmer/component") {
    return synthetic({
      default: class {
        constructor(_owner, args) {
          this.args = args;
        }
      },
    });
  }
  if (specifier === "@ember/object") {
    return synthetic({ action() {} });
  }
  if (specifier === "@ember/service") {
    return synthetic({ service() {} });
  }
  if (specifier === "virtual:theme") {
    return synthetic({ themePrefix: (key) => key });
  }
  if (specifier === "discourse-i18n") {
    return synthetic({ i18n: (key) => key });
  }
  if (specifier === "@ember/modifier") {
    return synthetic({ on() {} });
  }
  throw new Error(`Unexpected cancel import: ${specifier}`);
});
await cancelModule.evaluate();
const Cancel = cancelModule.namespace.default;
assert.equal(new Cancel(undefined, {}).visible, false);
for (const [name, composerModel, expected] of [
  ["marketplace create", model({ action: "createTopic" }), true],
  ["marketplace first-post edit", edit, true],
  ["quick post", model({ action: "createTopic", categoryId: 43 }), true],
  [
    "ordinary first-post edit",
    model({
      categoryId: 43,
      creatingTopic: false,
      editingPost: true,
      post: { post_number: 1 },
    }),
    false,
  ],
  [
    "marketplace reply",
    model({ creatingTopic: false, action: "reply" }),
    false,
  ],
  [
    "marketplace reply edit",
    model({
      creatingTopic: false,
      editingPost: true,
      post: { post_number: 2 },
    }),
    false,
  ],
  ["event create", model({ action: "createTopic", categoryId: 51 }), false],
  [
    "learning create",
    model({
      action: "createTopic",
      categoryId: 52,
      site: { isbf_marketplace: config, isbf_learning: { category_id: 52 } },
    }),
    false,
  ],
]) {
  assert.equal(
    isMarketplaceComposer(composerModel),
    name.startsWith("marketplace") && !name.includes("reply"),
    name
  );
  const cancel = new Cancel(undefined, {
    outletArgs: { model: composerModel },
  });
  assert.equal(cancel.visible, expected, name);
}
assert.match(cancelSource, /\{\{#if this\.visible\}\}/);
assert.match(cancelSource, /\{\{on "click" this\.close\}\}/);
assert.match(cancelSource, /type="button"/);
const cancel = new Cancel(undefined, { outletArgs: { model: fresh } });
const closeEvent = { type: "click" };
let saveAndCloseCalls = 0;
cancel.composer = {
  saveAndClose(event) {
    assert.equal(event, closeEvent);
    saveAndCloseCalls++;
  },
};
cancel.close(closeEvent);
assert.equal(
  saveAndCloseCalls,
  1,
  "Cancel must retain native draft save-and-close"
);
const homeSource = composerSource.slice(
  composerSource.indexOf("export class ISBFMarketplaceHome")
);
assert.match(
  homeSource,
  /<ISBFHomeDisplayOption\s+class="isbf-marketplace-composer__home"/
);
assert.match(homeSource, /@checked=\{\{this\.model\.isbf_marketplace_home\}\}/);
assert.match(homeSource, /@onChange=\{\{this\.changeHome\}\}/);
assert.match(
  homeSource,
  /@label=\{\{i18n \(themePrefix "isbf_v2\.marketplace_home"\)\}\}/
);
const sharedHomeSource = read(
  "javascripts/discourse/components/isbf-home-display-option.gjs"
);
assert.match(sharedHomeSource, /<label class="isbf-home-display-option"/);
assert.match(sharedHomeSource, /type="checkbox"/);
assert.match(sharedHomeSource, /\{\{on "change" @onChange\}\}/);
assert.match(sharedHomeSource, /<span>\{\{@label\}\}<\/span>/);
assert.doesNotMatch(sharedHomeSource, /\{\{on "click"/);
// Inspect only the relevant rule blocks; this does not compile SCSS or verify DOM layout.
function styleRule(source, selector) {
  const match = selector.exec(source);
  assert.ok(match, `Missing style rule: ${selector}`);
  const opening = source.indexOf("{", match.index);
  let depth = 1;
  let closing = opening + 1;
  for (; depth && closing < source.length; closing++) {
    if (source[closing] === "{") {
      depth++;
    } else if (source[closing] === "}") {
      depth--;
    }
  }
  assert.equal(depth, 0, `Unclosed style rule: ${selector}`);
  return source.slice(opening + 1, closing - 1);
}
const composerScope =
  /html\.composer-open\s+body:has\(\.isbf-v2-shell\)\s+#reply-control\.open:has\(\.isbf-marketplace-composer\)\s*\{/;
const desktopComposerStyles = styleRule(styles, composerScope);
assert.match(
  styleRule(desktopComposerStyles, /\.title-and-category\s*\{/),
  /display:\s*grid\s*;/
);
assert.match(
  styleRule(
    desktopComposerStyles,
    /\.category-input,\s*\.tags-input,\s*\.isbf-marketplace-composer-options\s*\{/
  ),
  /grid-row:\s*3\s*;/
);
const homeStyles = styleRule(
  desktopComposerStyles,
  /\.isbf-marketplace-composer__home\s*\{/
);
assert.match(homeStyles, /min-height:\s*44px\s*;/);
assert.match(homeStyles, /gap:\s*8px\s*;/);
const mobileStyles = sharedMobileStyles;
const mobileComposerScope =
  /html\.composer-open\s+body:has\(\.isbf-v2-shell\)\s+#reply-control\.open:has\(\.isbf-v2-composer\):is\(\s*:has\(\.isbf-marketplace-composer\),\s*:has\(\.isbf-teamup-composer\),\s*:has\(\.isbf-careers-composer\)\s*\)\s*\{/;
const mobileComposerStyles = styleRule(mobileStyles, mobileComposerScope);
assert.match(
  styleRule(mobileComposerStyles, /\.d-editor-textarea-column\s*\{/),
  /display:\s*grid\s*;/
);
// The native viewport variable follows the keyboard; all overrides stay mobile
// and require the marketplace fields rendered for creates or first-post edits.
assert.match(
  mobileComposerStyles,
  /height:\s*calc\(var\(--composer-vh,\s*1dvh\)\s*\*\s*100\)\s*;/
);
const mobileHeader = styleRule(mobileComposerStyles, /\.reply-to\s*\{/);
const mobileActions = styleRule(mobileComposerStyles, /\.save-or-cancel\s*\{/);
for (const rule of [mobileHeader, mobileActions]) {
  assert.match(
    rule,
    /height:\s*calc\(48px\s*\+\s*env\(safe-area-inset-top\)\)\s*;/
  );
  assert.match(rule, /min-height:\s*0\s*;/);
}
assert.match(
  styleRule(mobileComposerStyles, /\.reply-area\s*\{/),
  /padding:\s*calc\(48px\s*\+\s*env\(safe-area-inset-top\)\)\s+0\s+0\s*;/
);
const duplicateControls = styleRule(
  mobileComposerStyles,
  /\.reply-to \.action-title,\s*\.reply-to \.composer-action-title,\s*\.reply-to \.composer-controls\s*\{/
);
assert.match(duplicateControls, /display:\s*none\s*;/);
const discard = styleRule(
  mobileComposerStyles,
  /(?:^|\})\s*\.save-or-cancel \.discard-button\s*\{/
);
assert.match(discard, /position:\s*static\s*;/);
assert.match(discard, /min-width:\s*44px\s*;/);
assert.doesNotMatch(discard, /display:\s*none\s*;/);
assert.match(
  styleRule(
    mobileComposerStyles,
    /\.save-or-cancel \.btn-primary,\s*\.save-or-cancel \.discard-button\s*\{/
  ),
  /min-height:\s*44px\s*;/
);
assert.match(
  mobileComposerStyles,
  /container:\s*isbf-workbench-composer\s*\/\s*size\s*;/
);
const shortViewport = styleRule(
  mobileStyles,
  /@container isbf-workbench-composer\s*\(height\s*<\s*360px\)\s*\{/
);
assert.match(shortViewport, /:has\(\.isbf-marketplace-composer\)/);
assert.match(
  shortViewport,
  /grid-template-rows:\s*auto\s+minmax\(44px,\s*1fr\)/
);
const mobileGrid = styleRule(
  mobileComposerStyles,
  /\.d-editor-textarea-column\s*\{/
);
assert.match(mobileGrid, /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/);
assert.match(mobileGrid, /min-height:\s*0\s*;/);
assert.match(
  mobileGrid,
  /overflow-y:\s*auto\s*;/,
  "Very short viewports must allow fields to scroll"
);
assert.doesNotMatch(
  mobileComposerStyles,
  /(?:min-height:\s*160px|minmax\(160px)/
);
const mobileDescription = styleRule(
  mobileComposerStyles,
  /\.d-editor-textarea-wrapper\s*\{/
);
assert.match(mobileDescription, /min-height:\s*0\s*;/);
assert.match(mobileDescription, /align-self:\s*stretch\s*;/);
const mobileInput = styleRule(mobileComposerStyles, /\.d-editor-input\s*\{/);
assert.match(mobileInput, /min-height:\s*0\s*;/);
assert.match(mobileInput, /height:\s*100%\s*;/);
assert.match(
  mobileInput,
  /overflow-y:\s*auto\s*;/,
  "Long descriptions must scroll internally"
);
const toolbarSpace = styleRule(mobileComposerStyles, /\.wmd-controls\s*\{/);
assert.match(
  toolbarSpace,
  /padding-bottom:\s*calc\(56px\s*\+\s*env\(safe-area-inset-bottom\)\)\s*;/
);
const keyboardComposerStyles = styleRule(
  mobileStyles,
  /html\.keyboard-visible\s+body:has\(\.isbf-v2-shell\)\s+#reply-control\.open:has\(\.isbf-v2-composer\):is\(\s*:has\(\.isbf-marketplace-composer\),\s*:has\(\.isbf-teamup-composer\),\s*:has\(\.isbf-careers-composer\)\s*\)\s*\{/
);
assert.match(
  styleRule(keyboardComposerStyles, /\.wmd-controls\s*\{/),
  /padding-bottom:\s*56px\s*;/
);
const mobileFields = styleRule(
  mobileComposerStyles,
  /\.composer-fields,\s*\.title-and-category\s*\{/
);
assert.match(mobileFields, /display:\s*contents\s*;/);
assert.match(mobileFields, /position:\s*static\s*;/);
for (const [selector, row] of [
  [/\.title-input\s*\{/, 1],
  [/\.d-editor-textarea-wrapper\s*\{/, 2],
  [/\.isbf-marketplace-composer,\s*\.isbf-careers-composer\s*\{/, 3],
  [/\.category-input,\s*\.tags-input\s*\{/, 4],
  [
    /\.isbf-marketplace-composer-options,\s*\.isbf-careers-composer-options\s*\{/,
    5,
  ],
]) {
  assert.match(
    styleRule(mobileComposerStyles, selector),
    new RegExp(`grid-row:\\s*${row}\\s*;`)
  );
}
for (const selector of [
  /\.category-input,\s*\.tags-input\s*\{/,
  /\.select-kit\s*\{/,
  /\.select-kit-header\s*\{/,
]) {
  const rule = styleRule(mobileComposerStyles, selector);
  assert.match(rule, /min-width:\s*0\s*;/);
  assert.match(rule, /max-width:\s*100%\s*;/);
}
assert.ok(feed.includes("this.config?.publishing_enabled !== false"));
const capabilityGetter = feed.slice(
  feed.indexOf("  get canCreate()"),
  feed.indexOf("  @action", feed.indexOf("  get canCreate()"))
);
const Capability = vm.runInContext(
  `(class Capability { ${capabilityGetter} })`,
  context
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
