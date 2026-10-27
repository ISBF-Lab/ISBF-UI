import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { flush, harness } from "./lib/calendar-harness.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const calls = [];
let respond = async () => ({});
let closed = 0;
class Component {
  constructor() {
    this.args = {
      model: { selectedDate: "2026-10-24", onSaved: async () => {} },
      closeModal: () => closed++,
    };
  }
}
const dependencies = {
  default: Component,
  action() {},
  cached() {},
  service() {},
  tracked() {},
  themePrefix: (key) => key,
  i18n: (key) => key,
  not() {},
  dUniqueId: () => "form-id",
  ajax: async (...args) => {
    calls.push(args);
    return respond(...args);
  },
};
async function load(path) {
  const source = read(path)
    .replace(/<template>[\s\S]*?<\/template>/g, "")
    .replace(/^\s*@service\s+\w+;\s*$/gm, "")
    .replace(/@(action|cached|tracked)\s+/g, "");
  const module = new vm.SourceTextModule(source);
  await module.link(async (name) => {
    if (name === "../lib/calendar-reminder") {
      const helper = new vm.SourceTextModule(
        read("javascripts/discourse/lib/calendar-reminder.js")
      );
      await helper.link(() => {});
      return helper;
    }
    return new vm.SyntheticModule(Object.keys(dependencies), function () {
      for (const [key, value] of Object.entries(dependencies)) {
        this.setExport(
          key,
          name === "discourse-i18n" && key === "default"
            ? { currentLocale: () => "zh_CN" }
            : value
        );
      }
      if (name.endsWith("d-unique-id")) {
        this.setExport("default", dependencies.dUniqueId);
      }
    });
  });
  await module.evaluate();
  return module.namespace;
}
const { calendarEntryKind, calendarEntryTime } = await load(
  "javascripts/discourse/lib/calendar-entry.js"
);
assert.equal(calendarEntryKind({}), "personal");
assert.equal(
  calendarEntryKind({ source_item_id: 12, source_unavailable: true }),
  "official"
);
const official = {
  source_item_id: 12,
  starts_at: "2026-10-24T05:00:00Z",
  ends_at: "2026-10-24T06:00:00Z",
};
assert.equal(calendarEntryTime(official), "13:00–14:00");
assert.equal(
  calendarEntryTime({ ...official, ends_at: official.starts_at }),
  "13:00"
);
assert.equal(
  calendarEntryTime({ ...official, all_day: true }),
  "isbf_v2.calendar_all_day"
);
assert.doesNotMatch(
  calendarEntryTime({ ...official, ends_at: "2026-10-25T06:00:00Z" }),
  /2026|北京时间|Asia/
);

for (const width of [390, 430, 600, 601, 768, 1024, 1440]) {
  const h = await harness(width, "2026-10-24T12:00:00", {
    officialOccursOn: () => true,
  });
  const entries = [
    {
      id: 1,
      title: "Manual",
      location: "Library",
      starts_at: "2026-10-24T05:00:00Z",
      ends_at: "2026-10-24T06:00:00Z",
    },
    { id: 2, ...official, title: "Official" },
    {
      id: 3,
      ...official,
      title: "Deadline",
      schedule_kind: "deadline",
      source_unavailable: true,
    },
  ];
  h.setHandler(async () => ({ entries }));
  const calendar = new h.Calendar();
  await flush();
  calendar.selectedDate = "2026-10-24";
  assert.equal(calendar.personalEntries.length, 1);
  assert.equal(calendar.officialEntries.length, 2);
  const rowCount = calendar.monthCells.length;
  calendar.setFilter("official");
  assert.deepEqual(
    Array.from(calendar.selectedItems, (item) => item.id),
    [2, 3]
  );
  assert.equal(calendar.monthCells.length, rowCount);
  const day = calendar.monthCells.find((cell) => cell.key === "2026-10-24");
  assert.equal(day.hasPersonal && day.hasOfficial, true);
  calendar.setFilter("personal");
  assert.deepEqual(
    Array.from(calendar.selectedItems, (item) => item.id),
    [1]
  );
  calendar.focusedEntryId = 2;
  calendar.setFilter("all");
  assert.equal(
    calendar.selectedItems.find((item) => item.id === 2).isFocused,
    true
  );
  assert.equal(
    h.calls.some((call) => call.path.includes("events.json")),
    false
  );
  let resolve;
  h.setHandler(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const pending = calendar.loadMonth();
  calendar.currentUser = { id: 8 };
  assert.equal(
    calendar.selectedItems.length,
    0,
    "Account switches immediately hide old entries"
  );
  resolve({ entries });
  await pending;
  assert.equal(
    calendar.selectedItems.length,
    0,
    "Old actor responses cannot populate another account"
  );
  calendar.willDestroy();
}

const Editor = (
  await load("javascripts/discourse/components/isbf-calendar-entry-editor.gjs")
).default;
const editor = new Editor();
const data = {
  ...editor.formData,
  title: "Study",
  location: " Library ",
  note: " Notes ",
  startTime: "13:00",
  endTime: "14:00",
};
respond = async () => {
  throw new Error("offline");
};
await editor.save(data);
assert.equal(editor.error, true);
assert.equal(editor.saving, false);
assert.equal(data.location, " Library ", "Failed saves preserve entered data");
let resolve;
respond = () =>
  new Promise((done) => {
    resolve = done;
  });
const pending = editor.save(data);
const count = calls.length;
editor.cancel();
await editor.save(data);
assert.equal(closed, 0);
assert.equal(calls.length, count, "Saving guards duplicate submissions");
assert.equal(editor.beforeClose(), false);
resolve({});
await pending;
assert.equal(closed, 1);
assert.equal(calls.at(-1)[1].data.entry.location, "Library");
assert.equal(
  calls.at(-1)[1].data.entry.ends_at > calls.at(-1)[1].data.entry.starts_at,
  true
);
const invalid = new Editor();
await invalid.save({ ...data, endTime: "12:00" });
assert.equal(invalid.error, true);
assert.equal(calls.length, count);
const allDay = new Editor();
respond = async () => ({});
await allDay.save({ ...data, allDay: true, location: "" });
assert.equal(calls.at(-1)[1].data.entry.ends_at, "2026-10-25T00:00:00.000Z");
assert.equal(calls.at(-1)[1].data.entry.location, "");

const calendarSource = read(
  "javascripts/discourse/components/isbf-v2-calendar.gjs"
);
assert.doesNotMatch(
  calendarSource,
  /discourse-post-event|schedule_imported|officialTimeLabel/
);
assert.match(calendarSource, /class="isbf-v2-calendar__item-actions"/);
assert.match(calendarSource, /calendar_note_action/);
const editorSource = read(
  "javascripts/discourse/components/isbf-calendar-entry-editor.gjs"
);
assert.match(editorSource, /<DModal[\s\S]*@hideHeader/);
assert.doesNotMatch(editorSource, /<:footer>/);
assert.match(editorSource, /maxlength="255"/);
const css = read("common/common.scss");
assert.match(
  css,
  /\.isbf-v2-calendar__item--personal\s*\{\s*border-left-color: var\(--isbf-v2-personal\)/
);
assert.match(
  css,
  /\.isbf-v2-calendar__item-actions\s*\{[\s\S]*?justify-content: flex-start/
);
const editorCss = css.slice(css.indexOf(".isbf-calendar-entry-editor {"));
const definedTokens = new Set(
  [...css.matchAll(/(--isbf-v2-[\w-]+)\s*:/g)].map((match) => match[1])
);
for (const [, token] of editorCss.matchAll(/var\((--isbf-v2-[\w-]+)\s*\)/g)) {
  assert.ok(
    definedTokens.has(token),
    `Editor references undefined theme token: ${token}`
  );
}

process.stdout.write(
  "Calendar entry source isolation, filters, location editor, retry and scoped layout checks passed."
);

const disabledEditor = new Editor();
disabledEditor.site = { isbf_calendar: { reminders: { enabled: false } } };
disabledEditor.args.model.entry = { id: 91, reminder_mode: "before_15m" };
disabledEditor.reminderMode = "before_15m";
assert.equal(disabledEditor.remindersVisible, true);
respond = async () => ({});
await disabledEditor.save(data);
assert.equal(
  Object.hasOwn(calls.at(-1)[1].data.entry, "reminder_mode"),
  false,
  "unrelated edits omit unchanged reminder while master disabled"
);
disabledEditor.reminderMode = "none";
await disabledEditor.save(data);
assert.equal(
  calls.at(-1)[1].data.entry.reminder_mode,
  "none",
  "clearing remains supported while master disabled"
);
