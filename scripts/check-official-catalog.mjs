import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const helper = new vm.SourceTextModule(
  readFileSync(
    new URL(
      "../javascripts/discourse/lib/official-filters.js",
      import.meta.url
    ),
    "utf8"
  )
);
await helper.link(() => {});
await helper.evaluate();
const {
  officialConfig,
  officialComposerItems,
  officialSelectionsAvailable,
  officialSelectionLimit,
  officialPayload,
  restoreOfficialSelections,
  buildOfficialQuery,
  officialLocationLabel,
} = helper.namespace;
const plain = (value) => JSON.parse(JSON.stringify(value));
const config = {
  category_id: 6,
  revision: 2,
  campuses: [
    { id: "south", label: "南校区新名称", enabled: false },
    { id: "north", label: "北校区", enabled: true },
  ],
  types: [
    { id: "clubs", label: "社团新名称", enabled: false },
    { id: "academic", label: "教务", enabled: true },
  ],
};
const model = (values) => ({
  categoryId: 6,
  creatingTopic: true,
  isbf_official_campuses: [],
  isbf_official_types: ["academic"],
  ...values,
  set(field, value) {
    this[field] = value;
  },
  setProperties(properties) {
    Object.assign(this, properties);
  },
});
assert.equal(officialConfig({ isbf_official: config }), config);
assert.ok(officialConfig({ isbf_official: { ...config, campuses: [] } }));
const legacy = {
  ...config,
  revision: undefined,
  types: [{ id: "clubs", label: "社团" }],
};
assert.equal(
  officialSelectionsAvailable(
    model({ isbf_official_types: ["clubs"] }),
    legacy
  ),
  true
);
assert.deepEqual(plain(officialComposerItems(config.types, [])), [
  config.types[1],
]);
assert.deepEqual(plain(officialComposerItems(config.campuses, [])), [
  config.campuses[1],
]);
assert.deepEqual(
  plain(officialComposerItems(config.types, ["clubs"])),
  config.types
);
assert.deepEqual(
  plain(officialComposerItems(config.types, ["missing"])).at(-1),
  { id: "missing", label: "missing", enabled: false }
);
assert.equal(officialSelectionsAvailable(model(), config), true);
for (const field of ["isbf_official_types", "isbf_official_campuses"]) {
  const disabled = field.endsWith("types") ? "clubs" : "south";
  assert.equal(
    officialSelectionsAvailable(model({ [field]: [disabled] }), config),
    false
  );
  const edited = model({
    creatingTopic: false,
    editingFirstPost: true,
    [field]: [disabled],
    post: { [field]: [disabled] },
  });
  assert.equal(officialSelectionsAvailable(edited, config), true);
  edited[field] = [];
  assert.equal(officialSelectionsAvailable(edited, config), true);
  assert.equal(
    officialSelectionsAvailable(
      model({
        editingFirstPost: true,
        [field]: [disabled],
        post: { [field]: [] },
      }),
      config
    ),
    false
  );
}
const draft = model({
  isbf_official_types: ["clubs", "missing"],
  reply: "Draft body",
  title: "Draft title",
  isbf_official_time_items: [{ id: "event" }],
});
const snapshot = JSON.stringify(draft);
restoreOfficialSelections(draft, config);
assert.equal(JSON.stringify(draft), snapshot);
assert.equal(
  officialPayload(draft, config, "isbf_official_types"),
  '["clubs","missing"]'
);
assert.equal(officialSelectionsAvailable(draft, config), false);
assert.equal(JSON.stringify(draft), snapshot);
const editedUnknown = model({
  editingFirstPost: true,
  isbf_official_types: null,
  topic: { isbf_official_types: ["missing"] },
});
restoreOfficialSelections(editedUnknown, config);
assert.deepEqual(plain(editedUnknown.isbf_official_types), ["missing"]);
assert.equal(officialSelectionLimit(Array(101).fill("academic")), false);
assert.equal(officialSelectionLimit(["中".repeat(1400)]), false);
assert.equal(officialSelectionLimit(Array(100).fill("academic")), true);
assert.equal(
  buildOfficialQuery(config, "south", "clubs"),
  "isbf-official:6 isbf-campus:south isbf-official-type:clubs order:activity"
);
assert.equal(
  buildOfficialQuery(config, "missing", "missing"),
  "isbf-official:6 order:activity"
);
assert.equal(
  officialLocationLabel("Hall", ["north", "south"], config),
  "南校区新名称、北校区 · Hall"
);
const extensions = {};
const registrations = [];
let refreshed = config;
let refreshFailure = false;
let ajaxOverride;
let ajaxCalls = 0;
const alerts = [];
vm.runInNewContext(
  readFileSync(
    new URL(
      "../javascripts/discourse/lib/official-composer-setup.js",
      import.meta.url
    ),
    "utf8"
  )
    .replace(/^import[\s\S]*?from "[^"]+";\s*/gm, "")
    .replace("export function setup", "function setup") +
    "\nsetup(api); setup({ ...api });",
  {
    ...helper.namespace,
    api: {
      addModelField(_model, field, options) {
        assert.equal(options.defaultValue, null);
        registrations.push(`field:${field}`);
      },
      addModelGetter(_model, property) {
        assert.equal(
          registrations.filter((entry) => entry.startsWith("field:")).length,
          2
        );
        registrations.push(`getter:${property}`);
      },
    },
    Composer: {
      serializeOnCreate(field) {
        registrations.push(`create:${field}`);
      },
      serializeOnUpdate(field) {
        registrations.push(`update:${field}`);
      },
      serializeToDraft(field) {
        registrations.push(`draft:${field}`);
      },
    },
    extendComposerMethod: (_api, name, extension) => {
      assert.equal(
        extensions[name],
        undefined,
        "Official methods register only once"
      );
      extensions[name] = extension;
    },
    themePrefix: (key) => key,
    i18n: (key) => key,
    ajax: async (url) => {
      ajaxCalls++;
      assert.equal(url, "/site.json");
      if (ajaxOverride) {
        return ajaxOverride();
      }
      if (refreshFailure) {
        throw new Error("offline");
      }
      return { isbf_official: refreshed };
    },
  }
);
for (const field of helper.namespace.OFFICIAL_FIELDS) {
  for (const kind of ["field", "create", "update", "draft"]) {
    assert.equal(
      registrations.filter((entry) => entry === `${kind}:${field}`).length,
      1
    );
  }
}
assert.equal(
  registrations.filter((entry) => entry.startsWith("getter:")).length,
  2
);
const saving = model({
  site: {
    isbf_official: config,
    set(field, value) {
      this[field] = value;
    },
  },
  dialog: {
    alert(message) {
      alerts.push(message);
    },
  },
  reply: "Preserve body",
  title: "Preserve title",
});
let nativeSaves = 0;
const nativeSave = () => {
  nativeSaves++;
  return "saved";
};
assert.equal(await extensions.save.call(saving, nativeSave), "saved");
assert.equal(nativeSaves, 1);
refreshed = {
  ...config,
  types: config.types.map((item) => ({ ...item, enabled: false })),
};
await extensions.save.call(saving, nativeSave);
assert.equal(nativeSaves, 1);
assert.equal(alerts.at(-1), "isbf_v2.official_classification_stale");
assert.deepEqual(saving.isbf_official_types, ["academic"]);
assert.equal(saving.reply, "Preserve body");
assert.equal(saving.title, "Preserve title");
refreshFailure = true;
await extensions.save.call(saving, nativeSave);
assert.equal(nativeSaves, 1);
assert.equal(alerts.at(-1), "isbf_v2.official_refresh_error");
assert.deepEqual(saving.isbf_official_types, ["academic"]);
refreshFailure = false;
refreshed = config;
const nativeError = {
  errors: ["Native error"],
  error_type: "isbf_official_classification_stale",
};
saving.isbf_official_time_items = [{ id: "event", title: "Keep time" }];
const preserved = JSON.stringify([
  saving.title,
  saving.reply,
  saving.isbf_official_types,
  saving.isbf_official_campuses,
  saving.isbf_official_time_items,
]);
const beforeFailure = ajaxCalls;
await assert.rejects(
  extensions.save.call(saving, () => {
    refreshed = { ...config, revision: 3 };
    return Promise.reject(nativeError);
  }),
  (error) => error === nativeError
);
assert.equal(ajaxCalls, beforeFailure + 2);
assert.equal(saving.site.isbf_official.revision, 3);
assert.equal(
  JSON.stringify([
    saving.title,
    saving.reply,
    saving.isbf_official_types,
    saving.isbf_official_campuses,
    saving.isbf_official_time_items,
  ]),
  preserved
);
refreshed = config;
await assert.rejects(
  extensions.save.call(saving, () => {
    refreshFailure = true;
    return Promise.reject(nativeError);
  }),
  (error) => error === nativeError
);
refreshFailure = false;
let resolveCatalog;
ajaxOverride = () =>
  new Promise((resolve) => {
    resolveCatalog = resolve;
  });
const beforeDouble = ajaxCalls;
const beforeNative = nativeSaves;
const firstSave = extensions.save.call(saving, nativeSave);
const secondSave = extensions.save.call(saving, nativeSave);
assert.equal(firstSave, secondSave);
assert.equal(ajaxCalls, beforeDouble + 1);
resolveCatalog({ isbf_official: config });
await Promise.all([firstSave, secondSave]);
assert.equal(nativeSaves, beforeNative + 1);
const abandoned = extensions.save.call(saving, nativeSave);
const oldConfig = saving.site.isbf_official;
extensions.clearState.call(saving, () => {});
await extensions.open.call(saving, async () => {});
saving.title = "New session";
saving.isbf_official_types = ["academic"];
resolveCatalog({ isbf_official: { ...config, revision: 99 } });
await abandoned;
assert.equal(nativeSaves, beforeNative + 1);
assert.equal(saving.site.isbf_official, oldConfig);
assert.equal(saving.title, "New session");
assert.deepEqual(saving.isbf_official_types, ["academic"]);
ajaxOverride = undefined;
assert.equal(await extensions.save.call(saving, nativeSave), "saved");
process.stdout.write(
  "Official catalog compatibility, availability, history, limits and draft preservation OK\n"
);
