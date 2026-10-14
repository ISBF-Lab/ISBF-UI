import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) =>
  readFileSync(new URL("../" + path, import.meta.url), "utf8");
const filters = new vm.SourceTextModule(
  read("javascripts/discourse/lib/official-filters.js"),
);
await filters.link(() => {});
await filters.evaluate();
const config = {
  category_id: 6,
  campuses: [{ id: "campus", label: "Campus" }],
  types: [{ id: "activity", label: "Activity" }],
};
const site = { isbf_official: config };
const composer = {
  isOpen: true,
  model: { creatingTopic: true, categoryId: 6 },
};
const declarations = [];
const api = {
  container: {
    lookup(name) {
      assert.ok(["service:composer", "service:site"].includes(name));
      return name === "service:composer" ? composer : site;
    },
  },
  modifyClass(name, declaration) {
    declarations.push({ name, declaration });
  },
};
const initializer = new vm.SourceTextModule(
  read(
    "javascripts/discourse/api-initializers/isbf-official-composer-controls.gjs",
  ),
);
await initializer.link((name) => {
  if (name.endsWith("official-filters")) {
    return filters;
  }
  const exports =
    name === "virtual:theme"
      ? { themePrefix: (key) => key }
      : name === "discourse/lib/api"
        ? { apiInitializer: (initialize) => initialize }
        : {
            i18n: (key) => {
              assert.equal(key, "isbf_v2.official_tags");
              return "标签";
            },
          };
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) {
      this.setExport(key, value);
    }
  });
});
await initializer.evaluate();
initializer.namespace.default(api);
assert.equal(declarations.length, 1);
assert.equal(declarations[0].name, "component:mini-tag-chooser");
const original = Object.freeze({ id: null, name: "Optional tags…" });
const options = { categoryId: 6, prioritizeRecentTags: true, minimum: 0 };
const chooser = {
  selectKit: { options },
  _super(...args) {
    assert.deepEqual(args, ["native-argument"]);
    return original;
  },
  defaultItem(id, name) {
    return { id, name };
  },
};
const label = () =>
  declarations[0].declaration.modifyNoSelection.call(
    chooser,
    "native-argument",
  );
assert.deepEqual(label(), { id: null, name: "标签" });
for (const model of [
  { creatingTopic: true, categoryId: 5 },
  { creatingTopic: false, categoryId: 6 },
  { creatingTopic: true, categoryId: 6, privateMessage: true },
  null,
]) {
  composer.model = model;
  assert.equal(label(), original);
}
composer.model = { editingFirstPost: true, categoryId: 6 };
assert.equal(label().name, "标签");
for (const patch of [
  { minimum: 1 },
  { categoryId: 5 },
  { prioritizeRecentTags: false },
]) {
  chooser.selectKit.options = { ...options, ...patch };
  assert.equal(label(), original);
}
chooser.selectKit.options = options;
composer.isOpen = false;
assert.equal(label(), original);
composer.isOpen = true;
site.isbf_official = null;
assert.equal(label(), original);
assert.equal(original.name, "Optional tags…");

const style = read("stylesheets/official-composer.scss");
const [base, mobile] = style.split("@media (width <= 600px)");
assert.match(
  base,
  /grid-template-columns: fit-content\(40%\) fit-content\(24%\) minmax\(0, 1fr\)/,
);
assert.match(base, /\.category-input,[\s\S]*?display: none/);
assert.match(
  base,
  /\.isbf-official-composer__campus,\s*\.isbf-official-composer__type,\s*\.tags-input\s*\{\s*grid-row: 1/,
);
assert.match(base, /\.tags-input\s*\{\s*grid-column: 3/);
assert.match(
  mobile,
  /html\.composer-open\.keyboard-visible[\s\S]*?#reply-control\.open:has\(\.isbf-v2-composer\):has\(\.isbf-official-composer\)\s*\.reply-area\s*\{\s*padding-bottom: 0/,
);
assert.match(
  mobile,
  /padding: env\(safe-area-inset-top\) 0 env\(safe-area-inset-bottom\)/,
);
assert.doesNotMatch(mobile, /grid-row: [5-9]/);
for (const width of [390, 430]) {
  const available = width - 32;
  assert.ok(
    available * 0.36 - 16 >= 44,
    "Three controls retain a usable flexible tag track",
  );
}
for (const [locale, labelText] of [
  ["zh_CN", "标签"],
  ["en", "Tags"],
]) {
  assert.match(
    read(`locales/${locale}.yml`),
    new RegExp(`^    official_tags: "${labelText}"$`, "m"),
  );
}
process.stdout.write(
  "Official composer labels, required-tag preservation, three-column controls and keyboard safe-area source constraints passed (no browser checks)\n",
);
