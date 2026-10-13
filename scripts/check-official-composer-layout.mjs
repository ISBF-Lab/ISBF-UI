import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const i18n = (key, options = {}) =>
  key + (options.count ? " · " + options.count : "");
const helper = new vm.SourceTextModule(
  read("javascripts/discourse/lib/official-calendar.js"),
);
await helper.link((name) => {
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
const {
  canonicalCalendarItems,
  calendarEditorSections,
  calendarItemsFromSections,
  OFFICIAL_CALENDAR_FIELD,
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
    ...globals,
  });
}
const opens = [];
const model = {
  categoryId: 6,
  creatingTopic: true,
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
editor.save(data);
assert.equal(saves, 0);
assert.match(editor.error, /schedule_too_many_items/);
editor.site.isbf_calendar.max_items = 20;
data.events[0].start = "";
editor.save(data);
assert.equal(saves, 0);
assert.equal(closes, 0);
assert.match(editor.error, /schedule_invalid_item/);
assert.equal(editor.section, "event");
({ editor, data } = mount(items, "event"));
data.deadlines[0].title = "";
editor.save(data);
assert.equal(saves, 0);
assert.equal(closes, 0);
assert.equal(
  editor.section,
  "deadline",
  "Invalid inactive section becomes active",
);
assert.equal(data.deadlines[0].title, "");
data.deadlines[0].title = "Corrected deadline";
editor.save(data);
assert.equal(saves, 1);
assert.equal(closes, 1);
({ editor, data } = mount());
editor.save(data);
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
  static serializeOnCreate(...args) {
    serializers.push(["create", ...args]);
  }

  static serializeOnUpdate(...args) {
    serializers.push(["update", ...args]);
  }

  static serializeToDraft(...args) {
    serializers.push(["draft", ...args]);
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
const calendarInitializer = new vm.SourceTextModule(
  read("javascripts/discourse/pre-initializers/isbf-official-calendar.js"),
);
await calendarInitializer.link((name) => {
  if (name === "../lib/official-calendar") {
    return helper;
  }
  const values =
    name === "discourse/models/composer"
      ? { default: NativeComposer }
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
  ["draft", OFFICIAL_CALENDAR_FIELD, OFFICIAL_CALENDAR_FIELD],
]);
const nativeComposer = new NativeComposer();
Object.assign(nativeComposer, {
  categoryId: 6,
  creatingTopic: true,
  site: { isbf_calendar: { official_category_id: 6 } },
  [OFFICIAL_CALENDAR_FIELD]: saved,
});
assert.deepEqual(
  JSON.parse(getters.isbfOfficialCalendarPayload.call(nativeComposer)),
  plain(saved),
);
assert.equal(nativeComposer.clearState("native-clear"), "cleared");
assert.deepEqual(nativeComposer.clearArgs, ["native-clear"]);
assert.equal(nativeComposer[OFFICIAL_CALENDAR_FIELD], null);
nativeComposer[OFFICIAL_CALENDAR_FIELD] = saved;
assert.equal(await nativeComposer.open("restored-draft"), "opened");
assert.deepEqual(nativeComposer.openArgs, ["restored-draft"]);
assert.deepEqual(
  plain(nativeComposer[OFFICIAL_CALENDAR_FIELD]),
  plain(saved),
  "Opening a restored draft keeps both sections and associations",
);
nativeComposer[OFFICIAL_CALENDAR_FIELD] = null;
nativeComposer.creatingTopic = false;
nativeComposer.editingFirstPost = true;
nativeComposer.post = { [OFFICIAL_CALENDAR_FIELD]: items };
await nativeComposer.open("edit");
assert.deepEqual(
  plain(nativeComposer[OFFICIAL_CALENDAR_FIELD]),
  plain(canonicalCalendarItems(items)),
);
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
