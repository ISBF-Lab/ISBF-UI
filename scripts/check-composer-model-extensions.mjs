import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../javascripts/discourse/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const names = ["isbf-campus-feed", "isbf-learning", "isbf-official"];
for (const name of names) {
  assert.doesNotMatch(
    read(`api-initializers/${name}.gjs`),
    /modifyClass\("model:/
  );
}

for (const { order, earlyFirst } of [names, [...names].reverse()].flatMap(
  (sequence) =>
    [true, false].map((early) => ({ order: sequence, earlyFirst: early }))
)) {
  const context = vm.createContext({ TextEncoder });
  const siteRequests = [];
  const siteUpdates = [];
  const freshSite = {
    isbf_official: {
      category_id: 8,
      revision: 1,
      campuses: [{ id: "zhuhai", label: "Updated campus", enabled: true }],
      types: [{ id: "academic", label: "Updated type", enabled: true }],
    },
  };
  const registrations = [];
  const serialized = { create: new Map(), update: new Map(), draft: new Map() };
  class Composer {
    static proto() {
      return this.prototype;
    }

    static serializeOnCreate(field, property) {
      registrations.push(`create:${field}`);
      serialized.create.set(field, property);
    }

    static serializeOnUpdate(field, property) {
      registrations.push(`update:${field}`);
      serialized.update.set(field, property);
    }

    static serializeToDraft(field, property) {
      registrations.push(`draft:${field}`);
      serialized.draft.set(field, property);
    }

    constructor() {
      this.site = {
        get(key) {
          return this[key];
        },
        set(key, value) {
          siteUpdates.push([key, value]);
          this[key] = value;
        },
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
    "discourse/lib/plugin-api": {
      withPluginApi: (callback) => callback(new Proxy(api, {})),
    },
    "discourse/lib/ajax": {
      ajax: async (url) => {
        siteRequests.push(url);
        assert.equal(url, "/site.json");
        return freshSite;
      },
    },
    "@ember/runloop": { scheduleOnce() {} },
    "virtual:theme": { themePrefix: (key) => key },
    "discourse-i18n": { i18n: (key) => key },
  };
  async function load(path) {
    if (!modules.has(path)) {
      modules.set(
        path,
        new vm.SourceTextModule(read(path), { context, identifier: path })
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
            { context }
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
            { context }
          );
        }
        if (specifier.endsWith("anonymous-post-scope")) {
          return new vm.SyntheticModule(
            ["canPublishAnonymously"],
            function () {
              this.setExport("canPublishAnonymously", () => false);
            },
            { context }
          );
        }
        if (specifier.endsWith("quick-post-scope")) {
          return new vm.SyntheticModule(
            ["isQuickPost"],
            function () {
              this.setExport("isQuickPost", () => false);
            },
            { context }
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
      addModelField(model, field, options) {
        assert.equal(model, "composer");
        assert.equal(options.defaultValue, null);
        registrations.push(`field:${field}`);
        Object.defineProperty(Composer.prototype, field, {
          value: options.defaultValue,
          writable: true,
          configurable: true,
        });
      },
      addModelMethod(model, name, callback) {
        registrations.push(`method:${name}`);
        assert.equal(model, "composer");
        Object.defineProperty(Composer.prototype, name, {
          value: callback,
          configurable: true,
        });
      },
      addModelGetter(model, name, getter) {
        if (name.startsWith("isbfOfficial")) {
          assert.equal(
            registrations.filter((entry) => entry.startsWith("field:")).length,
            2,
            "Native fields register before official payload getters"
          );
        }
        registrations.push(`getter:${name}`);
        assert.equal(model, "composer");
        Object.defineProperty(Composer.prototype, name, {
          get: getter,
          configurable: true,
        });
      },
    },
    { get: (target, key) => target[key] ?? (() => {}) }
  );
  const early = await load("pre-initializers/isbf-official-composer.js");
  await early.evaluate();
  assert.equal(early.namespace.default.name, "isbf-official-composer");
  assert.equal(early.namespace.default.after, "isbf-composer-optional-title");
  assert.equal(early.namespace.default.before, "inject-discourse-objects");
  if (earlyFirst) {
    early.namespace.default.initialize();
  }
  for (const name of order) {
    const module = await load(`api-initializers/${name}.gjs`);
    await module.evaluate();
    module.namespace.default(api);
  }
  if (!earlyFirst) {
    early.namespace.default.initialize();
  }
  for (const field of ["isbf_official_campuses", "isbf_official_types"]) {
    for (const kind of ["field", "create", "update", "draft"]) {
      assert.equal(
        registrations.filter((entry) => entry === `${kind}:${field}`).length,
        1
      );
    }
    assert.ok(
      registrations.indexOf(`field:${field}`) <
        registrations.indexOf(`create:${field}`)
    );
  }
  for (const property of [
    "isbfOfficialCampusesPayload",
    "isbfOfficialTypesPayload",
  ]) {
    assert.equal(
      registrations.filter((entry) => entry === `getter:${property}`).length,
      1
    );
  }
  for (const [method, count] of [
    ["clearState", 3],
    ["open", 2],
    ["save", 2],
  ]) {
    assert.equal(
      registrations.filter((entry) => entry === `method:${method}`).length,
      count,
      "Both entry points share one official method hook"
    );
  }
  const model = new Composer();
  assert.equal(model.isbf_official_campuses, null);
  assert.equal(model.isbf_official_types, null);
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
  assert.deepEqual(
    siteRequests,
    [],
    "Learning saves must not refresh the official catalog"
  );
  assert.deepEqual(siteUpdates, []);
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
    "Missing official selections must not submit"
  );
  assert.deepEqual(siteRequests, ["/site.json"]);
  assert.deepEqual(siteUpdates, [["isbf_official", freshSite.isbf_official]]);
  assert.equal(model.site.get("isbf_official"), freshSite.isbf_official);
  assert.deepEqual(model.site.isbf_learning, { category_id: 10 });
  model.isbf_official_campuses = ["zhuhai"];
  model.isbf_official_types = ["academic"];
  assert.equal(model.isbfOfficialCampusesPayload, '["zhuhai"]');
  assert.equal(await model.save(), "native-save");
  assert.equal(
    model.nativeSaves,
    2,
    "Valid official metadata must submit exactly once"
  );
  assert.deepEqual(siteRequests, ["/site.json", "/site.json"]);
  assert.deepEqual(siteUpdates, [
    ["isbf_official", freshSite.isbf_official],
    ["isbf_official", freshSite.isbf_official],
  ]);
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
    "Editing must restore official metadata"
  );
  model.categoryId = 4;
  assert.equal(model.isbfLearningCoursePayload, undefined);
  assert.equal(model.isbfOfficialTypesPayload, undefined);
  assert.equal(
    await model.save(),
    "native-save",
    "Ordinary replies must still submit"
  );
  assert.equal(model.nativeSaves, 3);
  assert.equal(
    siteRequests.length,
    2,
    "Ordinary replies must not refresh the official catalog"
  );
  assert.equal(siteUpdates.length, 2);
  assert.equal(
    serialized.draft.get("isbf_optional_title"),
    "isbf_optional_title"
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
process.stdout.write(
  "Composer model APIs: method chains, native arguments/results, field cleanup, draft metadata and both validation paths OK"
);
