import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const context = vm.createContext({});
const translations = Object.fromEntries(
  [...read("locales/zh_CN.yml").matchAll(/^\s+(\w+): "([^"\n]+)"/gm)].map(
    ([, key, value]) => ["isbf_v2." + key, value],
  ),
);
const i18n = (key, options = {}) =>
  (translations[key] ?? key).replace(/%\{(\w+)\}/g, (_, name) => options[name]);
const modules = new Map();
async function load(path) {
  if (!modules.has(path)) {
    const module = new vm.SourceTextModule(read(path), { context });
    modules.set(path, module);
    await module.link((specifier) => {
      const values =
        specifier === "virtual:theme"
          ? { themePrefix: (key) => key }
          : specifier === "discourse-i18n"
            ? { default: { currentLocale: () => "zh_CN" }, i18n }
            : null;
      if (values) {
        return new vm.SyntheticModule(
          Object.keys(values),
          function () {
            for (const [key, value] of Object.entries(values)) {
              this.setExport(key, value);
            }
          },
          { context },
        );
      }
      return load(
        "javascripts/discourse/lib/" + specifier.split("/").at(-1) + ".js",
      );
    });
  }
  return modules.get(path);
}
const helper = await load("javascripts/discourse/lib/official-calendar.js");
await helper.evaluate();
const {
  OFFICIAL_CALENDAR_FIELD,
  officialCalendarTopicTitle,
  officialCalendarNeedsTitle,
  officialCalendarItemTitle,
  calendarItemsWithTopicTitle,
  calendarEditorSections,
  calendarItemsFromSections,
  canonicalCalendarItems,
  officialCalendarEventOptionLabel,
} = helper.namespace;
const internal =
  "校园动态 [isbf-untitled:22222222-2222-4222-8222-222222222222]";
for (const [model, expected] of [
  [
    {
      creatingTopic: true,
      title: " Native ",
      isbf_optional_title: " Visible ",
    },
    "Visible",
  ],
  [{ creatingTopic: true, title: "Native", isbf_optional_title: "" }, ""],
  [{ creatingTopic: true, title: "Native", isbf_optional_title: " \n " }, ""],
  [{ creatingTopic: true, title: " Legacy " }, "Legacy"],
  [{ creatingTopic: true, title: internal }, ""],
  [{ creatingTopic: true, title: "Other", isbf_optional_title: internal }, ""],
  [
    {
      editingFirstPost: true,
      title: " Current ",
      isbf_optional_title: "Stale",
    },
    "Current",
  ],
  [{ editingFirstPost: true, title: internal }, ""],
  [{}, ""],
]) {
  assert.equal(officialCalendarTopicTitle(model), expected);
}
const make = (id, kind, extra = {}) => ({
  id,
  revision: 3,
  title: "Legacy " + id,
  schedule_kind: kind,
  starts_at: "2026-10-20T01:30:13.123Z",
  ends_at: "2026-10-20T01:30:13.123Z",
  all_day: false,
  ...extra,
});
const items = [
  make("event", "event", {
    registration_deadline_id: "linked",
    location: "Hall",
    organizer: "Club",
  }),
  make("cancelled", "deadline", { cancelled: true }),
  make("linked", "deadline"),
  make("independent", "deadline"),
  make("second", "event"),
];
const original = plain(items);
const site = { isbf_calendar: { official_category_id: 6 } };
const model = {
  categoryId: 6,
  creatingTopic: true,
  [OFFICIAL_CALENDAR_FIELD]: items,
};
assert.equal(officialCalendarNeedsTitle(model, site), true);
assert.equal(
  officialCalendarNeedsTitle(
    { ...model, creatingTopic: false, editingFirstPost: true },
    site,
  ),
  true,
);
for (const [override, capability] of [
  [{ categoryId: 7 }, site],
  [{ creatingTopic: false }, site],
  [{ privateMessage: true }, site],
  [{ creatingPrivateMessage: true }, site],
  [{ archetypeId: "private_message" }, site],
  [{ topic: { archetype: "private_message" } }, site],
  [{ [OFFICIAL_CALENDAR_FIELD]: [] }, site],
  [{ [OFFICIAL_CALENDAR_FIELD]: [items[1]] }, site],
  [{ [OFFICIAL_CALENDAR_FIELD]: null }, site],
  [{}, {}],
]) {
  assert.equal(
    officialCalendarNeedsTitle({ ...model, ...override }, capability),
    false,
  );
}
for (const kind of ["event", "deadline"]) {
  assert.equal(officialCalendarItemTitle("  校园讲座  ", kind), "校园讲座");
  for (const blank of ["", " \n ", internal]) {
    assert.throws(() => officialCalendarItemTitle(blank, kind), {
      name: "RangeError",
    });
    const temporary = officialCalendarItemTitle(blank, kind, { draft: true });
    assert.ok(temporary.trim());
    assert.doesNotMatch(temporary, /isbf-untitled|isbf_v2\./);
  }
  for (const value of [
    "中".repeat(121),
    "😀".repeat(121),
    "a".repeat(119) + "👩🏽‍💻",
    "a".repeat(119) + "e\u0301",
    "👨‍👩‍👧‍👦".repeat(30),
  ]) {
    const bounded = officialCalendarItemTitle(value, kind);
    assert.ok(Array.from(bounded).length <= 120);
    const boundaries = [
      ...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(value),
    ].map((segment) => segment.index + segment.segment.length);
    assert.ok(
      boundaries.includes(bounded.length),
      "Truncation ends at a whole grapheme",
    );
    assert.equal(value.startsWith(bounded), true);
  }
  assert.equal(
    officialCalendarItemTitle("😀".repeat(120), kind),
    "😀".repeat(120),
  );
}
const renamed = calendarItemsWithTopicTitle(items, "  最新标题  ");
assert.equal(renamed.length, 4);
assert.ok(renamed.every((item) => item.title === "最新标题"));
assert.deepEqual(
  plain(renamed).map((item) => {
    delete item.title;
    return item;
  }),
  plain(canonicalCalendarItems(items)).map((item) => {
    delete item.title;
    return item;
  }),
);
assert.equal(renamed[0].registration_deadline_index, 1);
assert.deepEqual(
  items,
  original,
  "Renaming preserves input and all canonical metadata",
);
assert.deepEqual(plain(calendarItemsWithTopicTitle([], "")), []);
assert.deepEqual(plain(calendarItemsWithTopicTitle([items[1]], "")), []);
assert.throws(() => calendarItemsWithTopicTitle(items, ""), {
  name: "RangeError",
});
const sections = calendarEditorSections(items);
const sectionsBefore = plain(sections);
assert.deepEqual(
  plain(calendarItemsFromSections(sections)),
  plain(canonicalCalendarItems(items)),
  "Legacy conversion without title is unchanged",
);
assert.deepEqual(
  plain(calendarItemsFromSections(sections, "最新标题")),
  plain(renamed),
);
assert.deepEqual(plain(sections), sectionsBefore);
assert.ok(
  calendarItemsFromSections(sections, "😀".repeat(120)).every(
    (item) => item.title === "😀".repeat(120),
  ),
  "Section validation counts Unicode code points rather than UTF-16 units",
);
const temporary = calendarItemsFromSections(sections, "");
assert.ok(
  temporary.every(
    (item) =>
      item.title ===
      officialCalendarItemTitle("", item.schedule_kind, { draft: true }),
  ),
);
for (const section of ["events", "deadlines"]) {
  const invalid = plain(sections);
  invalid[section][0].start = "2026-02-30T09:00";
  assert.throws(
    () => calendarItemsFromSections(invalid, "Title"),
    (error) => error.section === (section === "events" ? "event" : "deadline"),
  );
}
const firstOption = officialCalendarEventOptionLabel(sections.events[0], 0);
assert.match(firstOption, /活动 1/);
assert.match(firstOption, /2026\/10\/20 09:30/);
assert.notEqual(
  firstOption,
  officialCalendarEventOptionLabel(sections.events[0], 1),
);
assert.match(
  officialCalendarEventOptionLabel({ start: "2026-10-20", all_day: true }, 0),
  /2026\/10\/20/,
);
assert.equal(officialCalendarEventOptionLabel({ start: "" }, 0), "活动 1");

function componentClass(name, globals = {}) {
  const source = read("javascripts/discourse/components/" + name + ".gjs");
  const className = source.match(/export default class (\w+)/)[1];
  const body = source
    .slice(
      source.indexOf("export default class"),
      source.indexOf("  <template>"),
    )
    .replace("export default class", "class")
    .replace(/@service (\w+);/g, "$1 = services.$1;")
    .replace(/@tracked\s+/g, "")
    .replace(/  @(?:action|cached)\r?\n/g, "");
  return vm.runInNewContext(body + "}\n" + className, {
    Component: class {
      constructor(args) {
        this.args = args;
      }
    },
    services: {},
    themePrefix: (key) => key,
    i18n,
    ...helper.namespace,
    ...globals,
  });
}
const Editor = componentClass("isbf-official-calendar-editor");
let topicTitle = "Opened title";
let saved;
let saves = 0;
let closes = 0;
const editor = new Editor({
  model: {
    items,
    section: "event",
    getTopicTitle: () => topicTitle,
    onSave: async (value) => {
      saves++;
      saved = value;
    },
  },
  closeModal: () => {
    closes++;
  },
});
editor.site = site;
const data = editor.formData;
assert.ok(
  data.events.concat(data.deadlines).every((item) => item.title === topicTitle),
);
topicTitle = "Changed after opening";
await editor.save(data);
assert.equal(saves, 1);
assert.equal(closes, 1);
assert.ok(saved.every((item) => item.title === topicTitle));
const beforeFailure = plain(data);
for (const reject of [
  () => {
    throw new Error("sync failure");
  },
  () => Promise.reject(new Error("async failure")),
]) {
  editor.args.model.onSave = reject;
  await editor.save(data);
  assert.equal(closes, 1, "Failed save keeps editor open");
  assert.ok(editor.error);
  assert.equal(editor.saving, false);
  assert.deepEqual(plain(data), beforeFailure);
}
let release;
editor.args.model.onSave = () => {
  saves++;
  return new Promise((resolve) => {
    release = resolve;
  });
};
const pending = editor.save(data);
assert.equal(editor.saving, true);
await editor.save(data);
assert.equal(saves, 2, "Duplicate submit while saving is ignored");
assert.equal(closes, 1);
release();
await pending;
assert.equal(closes, 2);
assert.equal(editor.saving, false);
editor.args.closeModal();
assert.equal(saves, 2, "Cancel never submits");
assert.doesNotMatch(
  read("javascripts/discourse/components/isbf-official-calendar-editor.gjs"),
  /@name="title"/,
);
// eslint-disable-next-line no-console
console.log(
  "Official time titles: visible title, Unicode bounds, metadata, sections, labels and async editor save PASS",
);
const emptyEditor = new Editor({
  model: {
    items: [],
    section: "deadline",
    getTopicTitle: () => "",
    onSave: (value) => {
      assert.deepEqual(plain(value), []);
    },
  },
  closeModal: () => {
    closes++;
  },
});
emptyEditor.site = site;
await emptyEditor.save(emptyEditor.formData);
assert.equal(closes, 4, "Empty sections can save with an optional blank title");
const Composer = componentClass("isbf-official-calendar-composer", {
  ISBFOfficialCalendarEditor: "Editor",
});
const currentModel = {
  ...model,
  title: "Before opening",
  set(key, value) {
    this[key] = value;
  },
};
const composer = new Composer({ model: currentModel });
composer.site = site;
let modalModel;
composer.modal = {
  show(component, options) {
    modalModel = options.model;
  },
};
composer.edit("event");
assert.equal(modalModel.getTopicTitle(), "Before opening");
currentModel.isbf_optional_title = "After opening";
assert.equal(modalModel.getTopicTitle(), "After opening");
assert.equal(
  currentModel[OFFICIAL_CALENDAR_FIELD],
  items,
  "Opening or cancel leaves model untouched",
);
const saveModal = modalModel.onSave;
for (const invalidate of [
  () => {
    composer.isDestroying = true;
  },
  () => {
    composer.args.model = { ...currentModel };
  },
  () => {
    currentModel.categoryId = 7;
  },
  () => {
    currentModel.creatingTopic = false;
  },
  () => {
    composer.site = {};
  },
]) {
  composer.isDestroyed = false;
  composer.isDestroying = false;
  composer.args.model = currentModel;
  currentModel.categoryId = 6;
  currentModel.creatingTopic = true;
  composer.site = site;
  invalidate();
  assert.throws(() => saveModal([]));
  assert.equal(currentModel[OFFICIAL_CALENDAR_FIELD], items);
}
composer.site = site;
currentModel.creatingTopic = true;
modalModel.onSave([]);
assert.deepEqual(plain(currentModel[OFFICIAL_CALENDAR_FIELD]), []);
const Title = componentClass("isbf-v2-composer-title", {
  EmberObject: { create: (value) => value },
  isQuickPost: () => true,
});
const titleModel = { ...model, isbf_optional_title: "", title: internal };
const title = new Title({ outletArgs: { model: titleModel } });
title.site = site;
title.composer = { get: () => 123 };
title.siteSettings = { max_topic_title_length: 255 };
assert.equal(title.titleRequired, true);
assert.equal(title.label, translations["isbf_v2.schedule_post_title"]);
assert.equal(title.validation.failed, true);
assert.equal(title.validation.lastShownAt, 123);
title.focused = true;
assert.equal(title.validation, undefined);
title.focused = false;
titleModel.isbf_optional_title = "Real title";
assert.equal(title.validation, undefined);
titleModel.isbf_optional_title = "";
for (const inactive of [[], [items[1]]]) {
  titleModel[OFFICIAL_CALENDAR_FIELD] = inactive;
  assert.equal(title.titleRequired, false);
  assert.equal(title.label, translations["isbf_v2.optional_title"]);
  assert.equal(title.validation, undefined);
}
titleModel[OFFICIAL_CALENDAR_FIELD] = items;
title.site = {};
assert.equal(title.titleRequired, false);
assert.equal(title.validation, undefined);
// eslint-disable-next-line no-console
console.log(
  "Official time titles: current composer closure, stale save guards and dynamic title validation PASS",
);
