import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const timeTranslations = {
  "isbf_v2.schedule_activity_start_line": "Start: %{date}",
  "isbf_v2.schedule_activity_end_line": "End: %{date}",
  "isbf_v2.schedule_activity_day_value": "%{date} · All day",
};
const i18n = (key, options = {}) =>
  key === "isbf_v2.official_campus_separator"
    ? "、"
    : timeTranslations[key]
      ? timeTranslations[key].replace("%{date}", options.date)
      : key + (options.count ? " · " + options.count : "");
const optionalTitles = new vm.SourceTextModule(
  read("javascripts/discourse/lib/optional-topic-title.js"),
);
await optionalTitles.link(() => {});
await optionalTitles.evaluate();
const helper = new vm.SourceTextModule(
  read("javascripts/discourse/lib/official-calendar.js"),
);
await helper.link((name) => {
  if (name.endsWith("optional-topic-title")) {
    return optionalTitles;
  }
  const values =
    name === "virtual:theme"
      ? { themePrefix: (key) => key }
      : { default: { currentLocale: () => "en" }, i18n };
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) {
      this.setExport(key, value);
    }
  });
});
await helper.evaluate();
const filters = new vm.SourceTextModule(
  read("javascripts/discourse/lib/official-filters.js"),
);
await filters.link(() => {});
await filters.evaluate();
const {
  canonicalCalendarItems,
  calendarEditorSections,
  calendarItemsFromSections,
  calendarItemsWithTopicTitle,
  OFFICIAL_CALENDAR_FIELD,
  officialActivityTimeLines,
  officialTimeLabel,
} = helper.namespace;
const make = (id, kind, extra = {}) => ({
  id,
  revision: 3,
  title: kind + id,
  schedule_kind: kind,
  starts_at: "2026-10-20T01:30:13.123Z",
  ends_at: "2026-10-20T01:30:13.123Z",
  all_day: false,
  ...extra,
});
const items = [
  make("independent", "deadline"),
  make("event", "event", {
    registration_deadline_id: "linked",
    location: "Hall",
    organizer: "Club",
  }),
  make("cancelled", "deadline", { cancelled: true }),
  make("linked", "deadline"),
  make("event2", "event"),
];
const untouched = plain(items);
const drafts = calendarEditorSections(items);
assert.deepEqual(
  plain(calendarItemsFromSections(drafts)),
  plain(canonicalCalendarItems(items)),
);
assert.deepEqual(
  items,
  untouched,
  "Drafting and saving do not mutate caller items",
);
assert.equal(drafts.deadlines[0].related_event, "");
assert.equal(drafts.deadlines[1].related_event, drafts.events[0].editor_key);
assert.equal(
  calendarItemsFromSections(drafts)[1].registration_deadline_index,
  2,
);
const newRow = (kind, position, extra = {}) => ({
  title: "New " + kind,
  schedule_kind: kind,
  all_day: false,
  start: "2026-10-21T09:00",
  end: "",
  editor_position: position,
  ...extra,
});
const added = plain(drafts);
added.events.push(newRow("event", 4, { editor_key: "event-4" }));
added.deadlines.push(
  newRow("deadline", 5, { related_event: "event-4" }),
  newRow("deadline", 6, { related_event: "" }),
);
const saved = calendarItemsFromSections(added);
assert.equal(saved.length, 7);
assert.equal(saved[4].registration_deadline_index, 5);
assert.deepEqual(
  plain(saved.slice(0, 4)),
  plain(canonicalCalendarItems(items)),
);
assert.equal(
  Object.keys(saved[4]).some((key) => key.startsWith("editor_")),
  false,
);
assert.deepEqual(
  plain(calendarItemsFromSections(calendarEditorSections(saved))),
  plain(saved),
);
for (const bad of [
  {
    ...added,
    deadlines: [
      ...added.deadlines,
      newRow("deadline", 7, { related_event: "event-4" }),
    ],
  },
  {
    ...added,
    deadlines: [newRow("deadline", 7, { related_event: "unknown" })],
  },
  {
    ...added,
    events: [...added.events, newRow("event", 7, { editor_key: "event-4" })],
  },
  {
    ...added,
    deadlines: [newRow("deadline", 7, { start: "2026-02-30T09:00" })],
  },
  {
    ...added,
    events: [
      newRow("event", 7, { editor_key: "test", end: "2026-10-20T08:00" }),
    ],
  },
  { ...added, deadlines: [newRow("deadline", 7, { title: "" })] },
  { ...added, deadlines: [newRow("deadline", 7, { title: "x".repeat(121) })] },
]) {
  assert.throws(() => calendarItemsFromSections(bad));
}
const allDay = make("day", "deadline", {
  all_day: true,
  starts_at: "2026-10-19T16:00:00.000Z",
  ends_at: "2026-10-20T16:00:00.000Z",
});
assert.deepEqual(
  plain(calendarItemsFromSections(calendarEditorSections([allDay]))),
  [allDay],
);

const activityTimeCases = [
  [
    "Timed range",
    make("range", "event", { ends_at: "2026-10-20T03:45:00Z" }),
    ["Start: Oct 20, 2026, 09:30", "End: Oct 20, 2026, 11:45"],
  ],
  [
    "Optional end is stored as equal timestamps",
    make("instant", "event"),
    ["Start: Oct 20, 2026, 09:30"],
  ],
  [
    "Equal instants with different timestamp representations",
    make("equal", "event", { ends_at: "2026-10-20T09:30:13.123+08:00" }),
    ["Start: Oct 20, 2026, 09:30"],
  ],
  [
    "Legacy date-only zero duration",
    make("day-instant", "event", { all_day: true }),
    ["Start: Oct 20, 2026 · All day"],
  ],
  [
    "Date-only single day uses exclusive end",
    { ...allDay, schedule_kind: "event" },
    ["Start: Oct 20, 2026 · All day"],
  ],
  [
    "Date-only multiple days use inclusive display end",
    { ...allDay, schedule_kind: "event", ends_at: "2026-10-22T16:00:00Z" },
    ["Start: Oct 20, 2026 · All day", "End: Oct 22, 2026"],
  ],
  [
    "Timed range crosses local midnight and year",
    make("year", "event", {
      starts_at: "2026-12-31T15:30:00Z",
      ends_at: "2026-12-31T16:30:00Z",
    }),
    ["Start: Dec 31, 2026, 23:30", "End: Jan 1, 2027, 00:30"],
  ],
  [
    "Date-only range crosses year with exclusive end",
    make("day-year", "event", {
      all_day: true,
      starts_at: "2026-12-30T16:00:00Z",
      ends_at: "2027-01-01T16:00:00Z",
    }),
    ["Start: Dec 31, 2026 · All day", "End: Jan 1, 2027"],
  ],
  [
    "Shanghai date differs from timestamp offset date",
    make("offset", "event", {
      starts_at: "2026-10-19T20:00:00-04:00",
      ends_at: "2026-10-19T21:00:00-04:00",
    }),
    ["Start: Oct 20, 2026, 08:00", "End: Oct 20, 2026, 09:00"],
  ],
];
for (const [description, item, expected] of activityTimeCases) {
  const original = plain(item);
  assert.deepEqual(
    plain(officialActivityTimeLines(item)),
    expected,
    description,
  );
  assert.deepEqual(item, original, description + " does not mutate its input");
  for (const line of officialActivityTimeLines(item)) {
    assert.doesNotMatch(line, /Beijing|Shanghai|UTC|GMT|北京时间/i);
  }
}
for (const item of [
  undefined,
  null,
  {},
  make("deadline", "deadline"),
  make("other", "other"),
  make("missing-start", "event", { starts_at: undefined }),
  make("missing-end", "event", { ends_at: undefined }),
  make("empty-start", "event", { starts_at: "" }),
  make("empty-end", "event", { ends_at: "" }),
  make("invalid-start", "event", { starts_at: "invalid" }),
  make("invalid-end", "event", { ends_at: "invalid" }),
  make("reverse", "event", { ends_at: "2026-10-20T01:00:00Z" }),
  make("reverse-day", "event", {
    all_day: true,
    starts_at: "2026-10-20T16:00:00Z",
    ends_at: "2026-10-19T16:00:00Z",
  }),
]) {
  const original = structuredClone(item);
  assert.deepEqual(plain(officialActivityTimeLines(item)), []);
  assert.deepEqual(item, original, "Invalid inputs are not mutated");
}
for (const [item, key] of [
  [make("old-event", "event"), "schedule_event_time"],
  [
    make("old-range", "event", { ends_at: "2026-10-20T03:00:00Z" }),
    "schedule_event_range",
  ],
  [{ ...allDay, schedule_kind: "event" }, "schedule_event_day"],
  [make("old-deadline", "deadline"), "schedule_deadline_time"],
  [allDay, "schedule_deadline_day"],
]) {
  assert.equal(officialTimeLabel(item), "isbf_v2." + key);
}

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
    .replace(/  @action\r?\n/g, "")
    .replace(/  @cached\r?\n/g, "");
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
    ...filters.namespace,
    ...globals,
  });
}
const opens = [];
const model = {
  categoryId: 6,
  creatingTopic: true,
  title: "Official title",
  [OFFICIAL_CALENDAR_FIELD]: items,
  set(key, value) {
    this[key] = value;
  },
};
const Composer = componentClass("isbf-official-calendar-composer", {
  ISBFOfficialCalendarEditor: "Editor",
});
const composer = new Composer({ model });
composer.site = { isbf_calendar: { official_category_id: 6 } };
composer.modal = { show: (...args) => opens.push(args) };
assert.equal(composer.visible, true);
assert.equal(composer.eventCount, 2);
assert.equal(composer.deadlineCount, 2);
assert.match(composer.eventLabel, /schedule_activity_count · 2$/);
assert.match(composer.deadlineLabel, /schedule_registration_count · 2$/);
composer.edit("event");
composer.edit("deadline");
assert.equal(opens[0][1].model.section, "event");
assert.equal(opens[1][1].model.section, "deadline");
opens[1][1].model.onSave([]);
assert.deepEqual(model[OFFICIAL_CALENDAR_FIELD], []);
assert.match(composer.eventLabel, /schedule_activity_time$/);
assert.match(composer.deadlineLabel, /schedule_registration_deadline$/);
for (const override of [
  { categoryId: 7 },
  { creatingTopic: false },
  { privateMessage: true },
  { creatingPrivateMessage: true },
  { archetypeId: "private_message" },
]) {
  composer.args.model = { ...model, ...override };
  assert.equal(composer.visible, false);
}
composer.args.model = {
  ...model,
  creatingTopic: false,
  editingFirstPost: true,
};
assert.equal(composer.visible, true);
composer.site = {};
assert.equal(composer.visible, false);

const Editor = componentClass("isbf-official-calendar-editor");
let saves = 0;
let closes = 0;
function mount(initial = items, section = "deadline", max = 20) {
  const editor = new Editor({
    model: {
      items: initial,
      section,
      getTopicTitle: () => "Official title",
      onSave() {
        saves++;
      },
    },
    closeModal() {
      closes++;
    },
  });
  editor.site = { isbf_calendar: { max_items: max } };
  const data = editor.formData;
  Object.defineProperty(editor, "formData", { value: data });
  const get = (path) =>
    path.split(".").reduce((object, key) => object[key], data);
  editor.registerApi({
    get,
    set(path, value) {
      const parts = path.split(".");
      const key = parts.pop();
      const object = parts.length ? get(parts.join(".")) : data;
      object[key] = value;
      editor.updateCount(path, value, data);
    },
  });
  return { editor, data };
}
let { editor, data } = mount();
assert.equal(editor.section, "deadline");
const prior = plain(data);
editor.selectSection("event");
editor.selectSection("deadline");
assert.deepEqual(plain(data), prior);
editor.addItem();
assert.equal(data.deadlines.at(-1).related_event, "");
assert.equal(data.deadlines.at(-1).start, "");
assert.equal(data.deadlines.at(-1).all_day, false);
const firstPosition = data.deadlines.at(-1).editor_position;
editor.removeItem("deadlines", data.deadlines.length - 1);
editor.addItem();
assert.ok(data.deadlines.at(-1).editor_position > firstPosition);
editor.removeItem("deadlines", data.deadlines.length - 1);
editor.removeItem("events", 0);
assert.equal(
  data.deadlines.length,
  1,
  "Removing event removes linked deadline",
);
assert.equal(data.deadlines[0].id, "independent");
assert.equal(calendarItemsFromSections(data).length, 2);
({ editor, data } = mount());
editor.removeItem("deadlines", 1);
assert.equal(
  calendarItemsFromSections(data)[1].registration_deadline_index,
  null,
);
const start = data.events[0].start;
editor.updateCount("events.0.all_day", true, data);
assert.equal(data.events[0].start, start.slice(0, 10));
editor.updateCount("events.0.all_day", false, data);
assert.equal(data.events[0].start, start.slice(0, 10) + "T09:00");
let focus;
editor.navigateTabs({
  key: "Home",
  preventDefault() {},
  currentTarget: {
    querySelector(selector) {
      focus = selector;
      return { focus() {} };
    },
  },
});
assert.equal(editor.section, "event");
assert.match(focus, /event/);
assert.equal(saves, 0, "Editing and closing without submitting never saves");
assert.equal(closes, 0);
({ editor, data } = mount(items, "event", 4));
assert.equal(editor.canAdd, false);
editor.addItem();
assert.equal(data.events.length + data.deadlines.length, 4);
editor.site.isbf_calendar.max_items = 3;
await editor.save(data);
assert.equal(saves, 0);
assert.match(editor.error, /schedule_too_many_items/);
editor.site.isbf_calendar.max_items = 20;
data.events[0].start = "";
await editor.save(data);
assert.equal(saves, 0);
assert.equal(closes, 0);
assert.match(editor.error, /schedule_invalid_item/);
assert.equal(editor.section, "event");
({ editor, data } = mount(items, "event"));
const validDeadlineStart = data.deadlines[0].start;
data.deadlines[0].start = "";
await editor.save(data);
assert.equal(saves, 0);
assert.equal(closes, 0);
assert.equal(
  editor.section,
  "deadline",
  "Invalid inactive section becomes active",
);
assert.equal(data.deadlines[0].start, "");
data.deadlines[0].start = validDeadlineStart;
await editor.save(data);
assert.equal(saves, 1);
assert.equal(closes, 1);
({ editor, data } = mount());
await editor.save(data);
assert.equal(saves, 2);
assert.equal(closes, 2);
({ editor, data } = mount());
editor.selectSection("event");
editor.addItem();
assert.equal(data.events.at(-1).start, "");
assert.equal(data.events.at(-1).end, "");
assert.equal(data.events.at(-1).all_day, false);
editor.args.closeModal();
assert.equal(saves, 2, "Cancel after editing never calls onSave");
assert.equal(closes, 3);
const modelFields = [];
const serializers = [];
const getters = {};
class NativeComposer {
  static proto() {
    return this.prototype;
  }

  static serializeOnCreate(...args) {
    serializers.push(["create", ...args]);
  }

  static serializeOnUpdate(...args) {
    serializers.push(["update", ...args]);
  }

  static serializeToDraft(...args) {
    serializers.push(["draft", ...args]);
  }

  save(...args) {
    this.nativeSaves = (this.nativeSaves ?? 0) + 1;
    this.saveArgs = args;
    return this.nativeResult;
  }

  clearState(...args) {
    this.clearArgs = args;
    return "cleared";
  }

  open(...args) {
    this.openArgs = args;
    return Promise.resolve("opened");
  }

  set(key, value) {
    this[key] = value;
  }
}
const calendarApi = {
  addModelField(...args) {
    modelFields.push(args);
  },
  addModelGetter(modelName, key, callback) {
    getters[key] = callback;
  },
  addModelMethod(modelName, key, callback) {
    NativeComposer.prototype[key] = callback;
  },
};
const extensions = new vm.SourceTextModule(
  read("javascripts/discourse/lib/composer-model-extensions.js"),
);
await extensions.link(
  () =>
    new vm.SyntheticModule(["default"], function () {
      this.setExport("default", NativeComposer);
    }),
);
await extensions.evaluate();
const calendarInitializer = new vm.SourceTextModule(
  read("javascripts/discourse/pre-initializers/isbf-official-calendar.js"),
);
await calendarInitializer.link((name) => {
  if (name === "../lib/composer-model-extensions") {
    return extensions;
  }
  if (name === "../lib/official-calendar") {
    return helper;
  }
  const values =
    name === "discourse/models/composer"
      ? { default: NativeComposer }
      : name === "virtual:theme"
        ? { themePrefix: (key) => key }
        : name === "discourse-i18n"
          ? { i18n }
          : { withPluginApi: (callback) => callback(calendarApi) };
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) {
      this.setExport(key, value);
    }
  });
});
await calendarInitializer.evaluate();
calendarInitializer.namespace.default.initialize();
assert.deepEqual(plain(modelFields), [
  ["composer", OFFICIAL_CALENDAR_FIELD, { defaultValue: null }],
]);
assert.deepEqual(serializers, [
  ["create", OFFICIAL_CALENDAR_FIELD, "isbfOfficialCalendarPayload"],
  ["update", OFFICIAL_CALENDAR_FIELD, "isbfOfficialCalendarPayload"],
  ["draft", OFFICIAL_CALENDAR_FIELD, "isbfOfficialCalendarDraftItems"],
]);
const nativeComposer = new NativeComposer();
Object.assign(nativeComposer, {
  categoryId: 6,
  creatingTopic: true,
  title: "Official title",
  site: { isbf_calendar: { official_category_id: 6 } },
  [OFFICIAL_CALENDAR_FIELD]: saved,
});
assert.deepEqual(
  JSON.parse(getters.isbfOfficialCalendarPayload.call(nativeComposer)),
  plain(calendarItemsWithTopicTitle(saved, "Official title")),
);
assert.equal(nativeComposer.clearState("native-clear"), "cleared");
assert.deepEqual(nativeComposer.clearArgs, ["native-clear"]);
assert.equal(nativeComposer[OFFICIAL_CALENDAR_FIELD], null);
nativeComposer[OFFICIAL_CALENDAR_FIELD] = saved;
assert.equal(await nativeComposer.open("restored-draft"), "opened");
assert.deepEqual(nativeComposer.openArgs, ["restored-draft"]);
assert.deepEqual(
  plain(nativeComposer[OFFICIAL_CALENDAR_FIELD]),
  plain(calendarItemsWithTopicTitle(saved, "Official title")),
  "Opening a restored draft keeps both sections and associations",
);
nativeComposer[OFFICIAL_CALENDAR_FIELD] = null;
nativeComposer.creatingTopic = false;
nativeComposer.editingFirstPost = true;
nativeComposer.post = { [OFFICIAL_CALENDAR_FIELD]: items };
await nativeComposer.open("edit");
assert.deepEqual(
  plain(nativeComposer[OFFICIAL_CALENDAR_FIELD]),
  plain(calendarItemsWithTopicTitle(items, "Official title")),
);
const renamedPayload = () =>
  JSON.parse(getters.isbfOfficialCalendarPayload.call(nativeComposer));
nativeComposer.title = "Changed after editor";
assert.ok(
  renamedPayload().every((item) => item.title === "Changed after editor"),
);
nativeComposer.creatingTopic = true;
for (const blank of [
  "",
  " \n ",
  "校园动态 [isbf-untitled:22222222-2222-4222-8222-222222222222]",
]) {
  nativeComposer.isbf_optional_title = blank;
  assert.equal(
    getters.isbfOfficialCalendarPayload.call(nativeComposer),
    undefined,
  );
  const draftItems =
    getters.isbfOfficialCalendarDraftItems.call(nativeComposer);
  assert.deepEqual(
    plain(draftItems),
    plain(calendarItemsWithTopicTitle(items, "", { draft: true })),
  );
  nativeComposer[OFFICIAL_CALENDAR_FIELD] = draftItems;
  await nativeComposer.open("restore-blank-title");
  assert.deepEqual(
    plain(nativeComposer[OFFICIAL_CALENDAR_FIELD]),
    plain(draftItems),
  );
}
nativeComposer.isbf_optional_title = "Restored title";
assert.ok(renamedPayload().every((item) => item.title === "Restored title"));
nativeComposer[OFFICIAL_CALENDAR_FIELD] = [];
nativeComposer.isbf_optional_title = "";
assert.deepEqual(renamedPayload(), []);
let focused = 0;
let customTitleAvailable = true;
let nativeTitleFocused = 0;
let settleAlert;
globalThis.document = {
  querySelector(selector) {
    assert.ok(
      [
        "#reply-control #isbf-optional-title",
        "#reply-control .title-input input",
      ].includes(selector),
    );
    if (
      selector === "#reply-control #isbf-optional-title" &&
      !customTitleAvailable
    ) {
      return null;
    }
    return {
      focus() {
        focused++;
        if (selector === "#reply-control .title-input input") {
          nativeTitleFocused++;
        }
      },
    };
  },
};
nativeComposer.dialog = {
  alert(message) {
    assert.match(message, /schedule_title_required/);
    return new Promise((resolve) => {
      settleAlert = resolve;
    });
  },
};
nativeComposer[OFFICIAL_CALENDAR_FIELD] = items;
nativeComposer.title = "Native stale";
nativeComposer.isbf_optional_title = " \n ";
const blocked = nativeComposer.save("blocked-options");
assert.equal(nativeComposer.nativeSaves, undefined);
assert.equal(focused, 0);
settleAlert();
await blocked;
assert.equal(focused, 1);
assert.equal(
  nativeTitleFocused,
  0,
  "The explicit custom title wins over the hidden native input",
);
customTitleAvailable = false;
assert.equal(nativeComposer[OFFICIAL_CALENDAR_FIELD], items);
nativeComposer.creatingTopic = false;
nativeComposer.title = "";
nativeComposer.isbf_optional_title = "Stale draft";
const blockedEdit = nativeComposer.save("edit-options");
settleAlert();
await blockedEdit;
assert.equal(focused, 2);
assert.equal(
  nativeTitleFocused,
  1,
  "First-post editing falls back to the current native title",
);
nativeComposer.title = "Current edit title";
const nativeResult = Promise.resolve("native-save");
nativeComposer.nativeResult = nativeResult;
assert.equal(
  nativeComposer.save("valid-edit-options"),
  nativeResult,
  "Preserve native return identity",
);
assert.deepEqual(nativeComposer.saveArgs, ["valid-edit-options"]);
nativeComposer.creatingTopic = true;
nativeComposer.isbf_optional_title = "";
for (const patch of [
  { [OFFICIAL_CALENDAR_FIELD]: [] },
  {
    [OFFICIAL_CALENDAR_FIELD]: [items[2], { ...items[0], cancelled: true }],
    categoryId: 7,
  },
  {
    [OFFICIAL_CALENDAR_FIELD]: items,
    categoryId: 6,
    creatingTopic: false,
    editingFirstPost: false,
  },
  { creatingTopic: true, site: {} },
]) {
  Object.assign(nativeComposer, patch);
  assert.equal(nativeComposer.save("unaffected-options"), nativeResult);
}
assert.equal(
  getters.isbfOfficialCalendarDraftItems.call(nativeComposer),
  nativeComposer[OFFICIAL_CALENDAR_FIELD],
  "Unavailable plugin draft leaves raw data intact",
);
nativeComposer[OFFICIAL_CALENDAR_FIELD] = null;
assert.equal(getters.isbfOfficialCalendarDraftItems.call(nativeComposer), null);
delete globalThis.document;
nativeComposer.categoryId = 7;
assert.equal(
  getters.isbfOfficialCalendarPayload.call(nativeComposer),
  undefined,
);

const composerSource = read(
  "javascripts/discourse/components/isbf-official-calendar-composer.gjs",
);
assert.equal((composerSource.match(/<DButton/g) || []).length, 2);
assert.match(composerSource, /@icon={{if this.eventCount "pencil" "plus"}}/);
assert.match(composerSource, /@icon={{if this.deadlineCount "pencil" "plus"}}/);
const editorSource = read(
  "javascripts/discourse/components/isbf-official-calendar-editor.gjs",
);
assert.match(editorSource, /role="tablist"/);
assert.equal((editorSource.match(/role="tabpanel"/g) || []).length, 2);
assert.doesNotMatch(
  editorSource,
  /has_registration_deadline|@name="schedule_kind"|addEventListener/,
);
assert.equal((editorSource.match(/<form.Submit/g) || []).length, 1);
// eslint-disable-next-line no-console
console.log("Official composer calendar sections: PASS");
const officialLayoutSource = read("stylesheets/official-composer.scss");
const officialFieldsSource = read(
  "javascripts/discourse/components/isbf-official-composer.gjs",
);
assert.doesNotMatch(officialFieldsSource, /official_selection_hint|<p>/);
assert.match(
  officialFieldsSource,
  /ISBFOfficialCalendarComposer @model={{@model}}/,
);
assert.match(
  officialLayoutSource,
  /#reply-control\.open:has\(\.isbf-v2-composer\):has\(\.isbf-official-composer\)/,
);
assert.match(
  officialLayoutSource,
  /grid-template-columns: repeat\(3, fit-content\(25%\)\) minmax\(0, 1fr\)/,
);
assert.match(officialLayoutSource, /@media \(width <= 600px\)/);
assert.match(
  officialLayoutSource,
  /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
);
assert.match(
  officialLayoutSource,
  /\.composer-fields,\s*\.title-and-category\s*\{\s*position: static/,
);
assert.match(officialLayoutSource, /min-height: 44px/);
assert.match(officialLayoutSource, /--composer-vh/);
assert.match(officialLayoutSource, /safe-area-inset-top/);
assert.match(officialLayoutSource, /safe-area-inset-bottom/);
assert.match(officialLayoutSource, /text-overflow: ellipsis/);
assert.match(officialLayoutSource, /aria-selected="true"/);
assert.doesNotMatch(
  officialLayoutSource,
  /min-height: 160px|isbf-marketplace|isbf-teamup/,
);
const [desktopLayout, mobileLayout] = officialLayoutSource.split(
  "@media (width <= 600px)",
);
assert.match(
  desktopLayout,
  /\.isbf-v2-composer-options,\s*\.title-and-category > \.title-input,\s*\.composer-fields > \.title-input\s*\{\s*display: none/,
  "Native generated title stays hidden while its data is retained",
);
assert.match(
  desktopLayout,
  /\.isbf-v2-composer-title\s*\{[^}]*position: static;[^}]*inset: auto;[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 3;/,
  "Place the optional-title wrapper in the Grid instead of its nested input",
);
assert.match(
  desktopLayout,
  /\.isbf-official-picker__trigger\s*\{[^}]*justify-content: flex-start;[^}]*gap: 8px;[^}]*width: auto;/,
);
assert.match(
  desktopLayout,
  /\.isbf-official-composer__type,\s*\.category-input\s*\{[^}]*justify-self: start;[^}]*width: max-content;/,
);
function gridRow(source, selector) {
  const rule = source.match(
    new RegExp("\\." + selector + "\\s*\\{[^}]*grid-row: (\\d+);"),
  );
  assert.ok(rule, "Missing explicit Grid row for " + selector);
  return Number(rule[1]);
}
assert.ok(
  gridRow(desktopLayout, "isbf-v2-composer-title") <
    gridRow(desktopLayout, "d-editor-textarea-wrapper"),
);
assert.ok(
  gridRow(mobileLayout, "isbf-v2-composer-title") <
    gridRow(mobileLayout, "d-editor-textarea-wrapper"),
);
// These are source layout constraints, not browser viewport regressions.
for (const width of [390, 430, 768, 1024, 1440]) {
  const layout = width <= 600 ? mobileLayout : desktopLayout;
  assert.ok(
    gridRow(layout, "isbf-v2-composer-title") <
      gridRow(layout, "d-editor-textarea-wrapper"),
    `Title precedes body under the ${width}px layout rules`,
  );
}
const titleSource = read(
  "javascripts/discourse/components/isbf-v2-composer-title.gjs",
);
assert.match(titleSource, /@value={{this.model.isbf_optional_title}}/);
assert.match(
  titleSource,
  /setOptionalTopicTitle\(this.model, event.target.value\)/,
);
assert.match(mobileLayout, /repeat\(2, minmax\(0, 1fr\)\)/);
assert.equal(
  (editorSource.match(/data-empty={{not item\.(?:start|end)}}/g) || []).length,
  3,
);
assert.equal(
  (editorSource.match(/isbf-official-calendar-editor__date-placeholder/g) || [])
    .length,
  3,
);
assert.equal(
  (
    editorSource.match(
      /@type={{if item.all_day "input-date" "input-datetime-local"}}/g,
    ) || []
  ).length,
  3,
);
assert.equal((editorSource.match(/@icon="trash-can"/g) || []).length, 2);
assert.equal(
  (editorSource.match(/class="isbf-official-calendar-editor__remove"/g) || [])
    .length,
  2,
);
assert.match(
  officialLayoutSource,
  /data-empty="true"\]:not\(\s*:focus-within\s*\)/,
);
assert.match(officialLayoutSource, /pointer-events: none/);
assert.match(
  officialLayoutSource,
  /\.isbf-official-calendar-editor__remove\s*\{[^}]*min-height: 44px;[^}]*border: 1px solid var\(--danger\)/,
);
assert.match(
  officialLayoutSource,
  /&:focus-visible\s*\{\s*outline: 2px solid var\(--isbf-v2-focus-ring\)/,
);
const calendarZh = read("locales/zh_CN.yml");
assert.match(calendarZh, /schedule_start: "活动开始时间"/);
assert.match(calendarZh, /schedule_end_optional: "活动结束时间"/);
assert.match(calendarZh, /schedule_date_placeholder: "年\/月\/日"/);
assert.match(read("locales/en.yml"), /schedule_start: "Activity start time"/);
// eslint-disable-next-line no-console
console.log(
  "Official-only Grid, responsive ordering, native controls and safety spacing source constraints: PASS",
);

const Summary = componentClass("isbf-official-activity-summary");
const summaryItems = plain(items);
const summaryCampuses = ["shenzhen", "zhuhai", "shenzhen", "unknown"];
const summary = new Summary({
  items: summaryItems,
  campusIds: summaryCampuses,
});
const summaryConfig = {
  category_id: 6,
  campuses: [
    { id: "zhuhai", label: "珠海校区" },
    { id: "shenzhen", label: "深圳校区" },
  ],
  types: [{ id: "clubs", label: "社团" }],
};
summary.site = { isbf_official: summaryConfig };
const originalSummaryConfig = structuredClone(summaryConfig);
const eventGroup = summary.groups.find((group) => group.item.id === "event");
assert.deepEqual(plain(eventGroup.timeLines), ["Start: Oct 20, 2026, 09:30"]);
assert.equal(eventGroup.timeLabel, null);
assert.equal(eventGroup.locationLabel, "珠海校区、深圳校区 · Hall");
assert.deepEqual(summaryCampuses, [
  "shenzhen",
  "zhuhai",
  "shenzhen",
  "unknown",
]);
assert.deepEqual(summaryConfig, originalSummaryConfig);
summary.args.campusIds = [];
assert.equal(
  summary.groups.find((group) => group.item.id === "event").locationLabel,
  "Hall",
);
summary.site = {};
assert.equal(
  summary.groups.find((group) => group.item.id === "event").locationLabel,
  "Hall",
);
assert.equal(eventGroup.deadlineLabel, "isbf_v2.schedule_deadline_time");
const deadlineGroup = summary.groups.find(
  (group) => group.item.id === "independent",
);
assert.deepEqual(plain(deadlineGroup.timeLines), []);
assert.equal(deadlineGroup.timeLabel, "isbf_v2.schedule_deadline_time");
assert.deepEqual(
  summaryItems,
  items,
  "Summary grouping does not mutate inputs",
);
const summarySource = read(
  "javascripts/discourse/components/isbf-official-activity-summary.gjs",
);
assert.match(
  summarySource,
  /timeLines:\s*officialActivityTimeLines\(group\.item\)/,
);
assert.match(
  summarySource,
  /<dd>\s*{{#each group\.timeLines as \|line\|}}\s*<span\s+class="isbf-official-activity-summary__time-line"\s*>\s*{{line}}\s*<\/span>\s*{{\/each}}\s*<\/dd>/,
);
assert.match(summarySource, /officialTimeLabel\(group\.deadline\)/);
assert.match(
  read("stylesheets/official-calendar.scss"),
  /(?:\.isbf-official-activity-summary__time-line|&__time-line)\s*\{[^}]*display: block;/,
);
// eslint-disable-next-line no-console
console.log("Official activity start/end lines and summary layout: PASS");

assert.match(
  summarySource,
  /<dd>{{if\s+group\.locationLabel\s+group\.locationLabel/,
);
assert.match(
  officialFieldsSource,
  /@allKey="isbf_v2\.official_campus_optional"/,
);
assert.match(officialFieldsSource, /@labelKey="isbf_v2\.official_campus"/);
assert.match(
  read("javascripts/discourse/components/isbf-v2-feed-card.gjs"),
  /<ISBFOfficialActivitySummary\s+[^>]*@campusIds={{@topic\.isbf_official_campuses}}[^>]*\/>/,
);
for (const locale of ["locales/zh_CN.yml", "locales/en.yml"]) {
  assert.match(read(locale), /official_campus_optional:\s*"[^"\n]+"/);
  assert.match(read(locale), /official_campus_separator:\s*"[^"\n]+"/);
}
// eslint-disable-next-line no-console
console.log(
  "Optional campus picker and campus-prefixed activity location: PASS",
);
