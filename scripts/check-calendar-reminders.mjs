import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../javascripts/discourse/lib/calendar-reminder.js", import.meta.url),
  "utf8"
);
const { ALL_DAY_REMINDERS, TIMED_REMINDERS, compatibleReminder, reminderTime } =
  await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
assert.deepEqual(TIMED_REMINDERS, [
  "none",
  "before_5m",
  "before_15m",
  "before_30m",
  "before_1h",
  "before_24h",
]);
assert.deepEqual(ALL_DAY_REMINDERS, [
  "none",
  "same_day_9am",
  "previous_day_9am",
]);
assert.equal(compatibleReminder("before_5m", true), "none");
assert.equal(compatibleReminder("same_day_9am", false), "none");
assert.equal(compatibleReminder("before_15m", false), "before_15m");
assert.equal(reminderTime("none", "2099-01-01", false, "Asia/Shanghai"), null);
assert.equal(
  new Date(
    reminderTime("before_15m", "2026-10-25T06:00:00Z", false, "Asia/Shanghai")
  ).toISOString(),
  "2026-10-25T05:45:00.000Z"
);
assert.equal(
  new Date(
    reminderTime("same_day_9am", "2026-10-25T00:00:00Z", true, "Asia/Shanghai")
  ).toISOString(),
  "2026-10-25T01:00:00.000Z"
);
assert.equal(
  new Date(
    reminderTime(
      "previous_day_9am",
      "2026-11-02T00:00:00Z",
      true,
      "America/New_York"
    )
  ).toISOString(),
  "2026-11-01T14:00:00.000Z"
);
assert.equal(
  new Date(
    reminderTime(
      "previous_day_9am",
      "2026-03-09T00:00:00Z",
      true,
      "America/New_York"
    )
  ).toISOString(),
  "2026-03-08T13:00:00.000Z"
);
process.stdout.write(
  "Calendar reminder mode compatibility, offsets, all-day timezone and DST checks passed."
);

const calls = [];
let closeCount = 0;
let model;
let respond;
class Component {
  constructor() {
    this.args = { model, closeModal: () => closeCount++ };
    this.site = { isbf_calendar: { reminders: { enabled: true } } };
  }
}
const reminderModule = new vm.SourceTextModule(source);
await reminderModule.link(() => {});
const dependencies = {
  "@glimmer/component": { default: Component },
  "@glimmer/tracking": { tracked: null },
  "@ember/object": { action: null },
  "@ember/service": { service: null },
  "virtual:theme": { themePrefix: (key) => key },
  "discourse/lib/ajax": {
    ajax: async (url, options) => {
      calls.push({ url, options });
      return respond(url, options);
    },
  },
  "discourse/ui-kit/d-button": { default: null },
  "discourse/ui-kit/d-modal": { default: null },
  "discourse-i18n": { i18n: (key) => key },
  "../lib/calendar-entry": { calendarEntryTime: () => "time" },
  "../lib/official-calendar": {
    OFFICIAL_CALENDAR_FIELD: "isbf_official_calendar_items",
    officialTimeLabel: () => "time",
  },
  "./isbf-calendar-reminder-picker": { default: null },
};
const dialog = new vm.SourceTextModule(
  readFileSync(
    new URL(
      "../javascripts/discourse/components/isbf-calendar-reminder-dialog.gjs",
      import.meta.url
    ),
    "utf8"
  )
    .replace(/<template>[\s\S]*<\/template>/, "")
    .replace(/^\s*@service\s+\w+;\s*$/gm, "")
    .replace(/@(tracked|action)\s+/g, "")
);
await dialog.link((name) => {
  if (name === "../lib/calendar-reminder") {
    return reminderModule;
  }
  assert.ok(dependencies[name], name);
  return new vm.SyntheticModule(Object.keys(dependencies[name]), function () {
    for (const [key, value] of Object.entries(dependencies[name])) {
      this.setExport(key, value);
    }
  });
});
await dialog.evaluate();
const Dialog = dialog.namespace.default;
const changes = [];
const item = {
  id: 12,
  revision: 3,
  title: "Event",
  starts_at: "2099-01-01T06:00:00Z",
  all_day: false,
};
model = { item, postId: 7, onChanged: (entry) => changes.push(entry) };
const cancelled = new Dialog();
cancelled.cancel();
assert.equal(closeCount, 1);
assert.equal(calls.length, 0, "Cancel never sends a request");
const conflict = new Dialog();
conflict.mode = "before_15m";
respond = async (url) => {
  if (url.startsWith("/posts/")) {
    return {
      isbf_official_calendar_items: [
        { ...item, revision: 4, title: "Updated" },
      ],
    };
  }
  throw { jqXHR: { status: 409 } };
};
await conflict.save();
assert.equal(calls.length, 2, "one POST and one source refresh only");
assert.equal(conflict.item.title, "Updated");
assert.equal(
  conflict.mode,
  "before_15m",
  "valid reminder retained after conflict"
);
assert.equal(conflict.changed, true);
assert.deepEqual(changes, []);
respond = async () => ({ entry: { id: 90, reminder_mode: "before_15m" } });
await conflict.save();
assert.equal(calls.length, 3, "explicit second confirmation sends retry");
assert.deepEqual(calls[2].options.data, {
  revision: 4,
  reminder_mode: "before_15m",
  reminder_timezone: "Asia/Shanghai",
});
assert.equal(changes[0].id, 90);
model = {
  item: { ...item, id: 90, source_unavailable: true },
  entry: { reminder_mode: "before_1h" },
  onChanged() {},
};
const unavailableDialog = new Dialog();
unavailableDialog.mode = "none";
await unavailableDialog.save();
assert.deepEqual(
  calls.at(-1).options.data,
  { entry: { reminder_mode: "none", reminder_timezone: "Asia/Shanghai" } },
  "an unavailable source permits clearing only"
);
process.stdout.write(
  "Official dialog Cancel, conflict refresh, explicit reconfirmation and unavailable-source clearing checks passed."
);

assert.equal(
  new Date(
    reminderTime(
      "same_day_9am",
      "2026-10-25T16:00:00Z",
      true,
      "Asia/Shanghai",
      true
    )
  ).toISOString(),
  "2026-10-26T01:00:00.000Z"
);
assert.equal(
  new Date(
    reminderTime(
      "previous_day_9am",
      "2026-10-25T16:00:00Z",
      true,
      "Asia/Shanghai",
      true
    )
  ).toISOString(),
  "2026-10-25T01:00:00.000Z"
);
assert.equal(
  new Date(
    reminderTime(
      "same_day_9am",
      "2026-10-25T00:00:00Z",
      true,
      "America/New_York"
    )
  ).toISOString(),
  "2026-10-25T13:00:00.000Z",
  "manual UTC date stays on the entered date"
);
model = {
  item: { ...item, starts_at: "2000-01-01T06:00:00Z" },
  onChanged() {},
};
const pastDialog = new Dialog();
pastDialog.mode = "before_5m";
const beforePastSave = calls.length;
await pastDialog.save();
assert.equal(
  calls.length,
  beforePastSave + 1,
  "past configuration can be saved without client catch-up delivery"
);
assert.equal(calls.at(-1).options.data.reminder_mode, "before_5m");
process.stdout.write(
  "Official all-day Beijing date and past-configuration persistence checks passed."
);

process.stdout.write("\n");

model = {
  item: { ...item, id: 90 },
  entry: { reminder_mode: "before_15m" },
  onChanged() {},
};
const disabledDialog = new Dialog();
disabledDialog.site.isbf_calendar.reminders.enabled = false;
assert.equal(disabledDialog.remindersUnavailable, true);
assert.equal(
  disabledDialog.saveDisabled,
  true,
  "disabled master prevents retaining/re-enabling non-none"
);
disabledDialog.mode = "none";
assert.equal(disabledDialog.saveDisabled, false);
await disabledDialog.save();
assert.equal(calls.at(-1).options.data.entry.reminder_mode, "none");
process.stdout.write("Disabled reminders remain clearable.\n");
