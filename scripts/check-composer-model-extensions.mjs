import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../javascripts/discourse/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const names = ["isbf-campus-feed", "isbf-learning", "isbf-official"];
for (const name of names) {
  assert.doesNotMatch(
    read(`api-initializers/${name}.gjs`),
    /modifyClass\("model:/,
  );
}

for (const order of [names, [...names].reverse()]) {
  const context = vm.createContext({});
  const serialized = { create: new Map(), update: new Map(), draft: new Map() };
  class Composer {
    static proto() {
      return this.prototype;
    }
    static serializeOnCreate(field, property) {
      serialized.create.set(field, property);
    }
    static serializeOnUpdate(field, property) {
      serialized.update.set(field, property);
    }
    static serializeToDraft(field, property) {
      serialized.draft.set(field, property);
    }
    constructor() {
      this.site = {
        isbf_learning: { category_id: 10 },
        isbf_official: {
          category_id: 8,
          campuses: [{ id: "zhuhai", label: "Campus" }],
          types: [{ id: "academic", label: "Type" }],
        },
      };
      this.alerts = [];
      this.dialog = { alert: (message) => this.alerts.push(message) };
      this.nativeClears = 0;
      this.nativeSaves = 0;
    }
    set(key, value) {
      this[key] = value;
    }
    setProperties(values) {
      Object.assign(this, values);
    }
    clearState(...args) {
      this.nativeClears++;
      this.otherPluginField = null;
      this.lastClearArgs = args;
      this.setProperties({ title: null, reply: null, post: null });
      return "native-clear";
    }
    open(options = {}) {
      Object.assign(this, options);
      return Promise.resolve("native-open");
    }
    save(...args) {
      this.nativeSaves++;
      this.lastSaveArgs = args;
      return Promise.resolve("native-save");
    }
  }
  const modules = new Map();
  const stubs = {
    "discourse/models/composer": { default: Composer },
    "discourse/lib/api": { apiInitializer: (callback) => callback },
    "@ember/runloop": { scheduleOnce() {} },
    "virtual:theme": { themePrefix: (key) => key },
    "discourse-i18n": { i18n: (key) => key },
  };
  async function load(path) {
    if (!modules.has(path)) {
      modules.set(
        path,
        new vm.SourceTextModule(read(path), { context, identifier: path }),
      );
      await modules.get(path).link(async (specifier) => {
        if (stubs[specifier]) {
          const exports = stubs[specifier];
          return new vm.SyntheticModule(
            Object.keys(exports),
            function () {
              for (const [key, value] of Object.entries(exports)) {
                this.setExport(key, value);
              }
            },
            { context },
          );
        }
        if (
          specifier.includes("components/") ||
          specifier.endsWith("learning-upload")
        ) {
          return new vm.SyntheticModule(
            ["default"],
            function () {
              this.setExport("default", class {});
            },
            { context },
          );
        }
        if (specifier.endsWith("anonymous-post-scope")) {
          return new vm.SyntheticModule(
            ["canPublishAnonymously"],
            function () {
              this.setExport("canPublishAnonymously", () => false);
            },
            { context },
          );
        }
        if (specifier.endsWith("quick-post-scope")) {
          return new vm.SyntheticModule(
            ["isQuickPost"],
            function () {
              this.setExport("isQuickPost", () => false);
            },
            { context },
          );
        }
        return load(`lib/${specifier.split("/").at(-1)}.js`);
      });
    }
    return modules.get(path);
  }
  const api = new Proxy(
    {
      modifyClass(resolver) {
        assert.equal(resolver, "controller:user");
      },
      addModelMethod(model, name, callback) {
        assert.equal(model, "composer");
        Object.defineProperty(Composer.prototype, name, {
          value: callback,
          configurable: true,
        });
      },
      addModelGetter(model, name, getter) {
        assert.equal(model, "composer");
        Object.defineProperty(Composer.prototype, name, {
          get: getter,
          configurable: true,
        });
      },
    },
    { get: (target, key) => target[key] ?? (() => {}) },
  );
  for (const name of order) {
    const module = await load(`api-initializers/${name}.gjs`);
    await module.evaluate();
    module.namespace.default(api);
  }
  const model = new Composer();
  model.creatingTopic = true;
  model.categoryId = 10;
  const fileId = "22222222-2222-4222-8222-222222222222";
  const options = {
    title: "Learning title",
    isbf_learning_course_id: "course",
    isbf_learning_files: [fileId],
  };
  assert.equal(await model.open(options), "native-open");
  assert.equal(model.isbf_learning_course_id, "course");
  assert.equal(model.isbfLearningFilesPayload, JSON.stringify([fileId]));
  assert.equal(model.isbf_anonymous, false);
  assert.equal(await model.save("native-options"), "native-save");
  assert.deepEqual(model.lastSaveArgs, ["native-options"]);
  model.title = "";
  await model.save();
  assert.equal(model.nativeSaves, 1, "Invalid learning title must not submit");
  model.title = "Valid";
  model.isbf_learning_course_id = "";
  await model.save();
  assert.equal(model.nativeSaves, 1, "Missing learning course must not submit");
  model.isbf_optional_title = "Previous title";
  model.isbf_official_campuses = ["zhuhai"];
  model.isbf_official_types = ["academic"];
  assert.equal(model.clearState("clear-options"), "native-clear");
  assert.equal(model.nativeClears, 1, "Core clearState must run exactly once");
  assert.equal(model.otherPluginField, null);
  assert.deepEqual(model.lastClearArgs, ["clear-options"]);
  for (const field of [
    "isbf_optional_title",
    "isbf_learning_course_id",
    "isbf_learning_files",
    "isbf_official_campuses",
    "isbf_official_types",
  ]) {
    assert.equal(model[field], null, `Must clear ${field}`);
  }
  model.categoryId = 8;
  await model.open({ title: "Official title" });
  await model.save();
  assert.equal(
    model.nativeSaves,
    1,
    "Missing official selections must not submit",
  );
  model.isbf_official_campuses = ["zhuhai"];
  model.isbf_official_types = ["academic"];
  assert.equal(model.isbfOfficialCampusesPayload, '["zhuhai"]');
  assert.equal(await model.save(), "native-save");
  model.clearState();
  model.creatingTopic = false;
  model.editingFirstPost = true;
  model.post = {
    isbf_official_campuses: ["zhuhai"],
    isbf_official_types: ["academic"],
  };
  await model.open();
  assert.equal(
    model.isbfOfficialTypesPayload,
    '["academic"]',
    "Editing must restore official metadata",
  );
  model.categoryId = 4;
  assert.equal(model.isbfLearningCoursePayload, undefined);
  assert.equal(model.isbfOfficialTypesPayload, undefined);
  assert.equal(
    await model.save(),
    "native-save",
    "Ordinary replies must still submit",
  );
  assert.equal(
    serialized.draft.get("isbf_optional_title"),
    "isbf_optional_title",
  );
  for (const field of [
    "isbf_learning_course_id",
    "isbf_learning_files",
    "isbf_official_campuses",
    "isbf_official_types",
  ]) {
    assert.ok(serialized.create.has(field));
    assert.ok(serialized.update.has(field));
    assert.equal(serialized.draft.get(field), field);
  }
}
console.log(
  "Composer model APIs: method chains, native arguments/results, field cleanup, draft metadata and both validation paths OK",
);
