import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const context = vm.createContext({});
const translations = Object.fromEntries(
  [...read("locales/zh_CN.yml").matchAll(/^\s+(\w+): "([^"\n]+)"/gm)].map(
    ([, key, value]) => ["isbf_v2." + key, value]
  )
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
          { context }
        );
      }
      return load(
        "javascripts/discourse/lib/" + specifier.split("/").at(-1) + ".js"
      );
    });
  }
  return modules.get(path);
}
const helper = await load("javascripts/discourse/lib/official-calendar.js");
await helper.evaluate();
const {
  officialCalendarItemTitle,
  officialCalendarTitleDuplicatesTopic,
  officialCalendarGroups,
  officialCalendarSummaryGroups,
  canonicalCalendarItems,
  calendarEditorSections,
} = helper.namespace;

const topicTitle = "校园讲座";
for (const kind of ["event", "deadline"]) {
  assert.equal(
    officialCalendarTitleDuplicatesTopic(
      { title: topicTitle, schedule_kind: kind },
      topicTitle
    ),
    true
  );
  const longTitle = "中".repeat(119) + "👨‍👩‍👧‍👦" + "校园讲座";
  const truncated = officialCalendarItemTitle(longTitle, kind);
  assert.equal(truncated, "中".repeat(119));
  assert.equal(
    officialCalendarTitleDuplicatesTopic(
      { title: truncated, schedule_kind: kind },
      longTitle
    ),
    true
  );
  assert.equal(
    officialCalendarTitleDuplicatesTopic(
      { title: "历史活动", schedule_kind: kind },
      topicTitle
    ),
    false
  );
  assert.equal(
    officialCalendarTitleDuplicatesTopic(
      { title: topicTitle, schedule_kind: kind },
      ""
    ),
    false
  );
}

const event = Object.freeze({
  id: 1,
  title: topicTitle,
  schedule_kind: "event",
  registration_deadline_id: 2,
  added: true,
});
const deadline = Object.freeze({
  id: 2,
  title: topicTitle,
  schedule_kind: "deadline",
  busy: true,
});
const historical = Object.freeze({
  id: 3,
  title: "旧活动",
  schedule_kind: "event",
});
const independent = Object.freeze({
  id: 4,
  title: "独立截止",
  schedule_kind: "deadline",
});
const cancelled = Object.freeze({
  id: 5,
  title: "撤销活动",
  schedule_kind: "event",
  cancelled: true,
});
const items = Object.freeze([
  deadline,
  event,
  historical,
  independent,
  cancelled,
]);
const before = plain(items);
const groups = officialCalendarGroups(items);
assert.equal(groups.length, 3);
assert.equal(groups[0].item, event);
assert.equal(groups[0].deadline, deadline);
assert.equal(groups[1].item, historical);
assert.equal(groups[2].item, independent);
assert.equal(groups[2].isEvent, false);
assert.equal(groups[0].item.added, true);
assert.equal(groups[0].deadline.busy, true);
assert.deepEqual(plain(items), before);

const indexedEvent = Object.freeze({
  ...event,
  registration_deadline_index: 0,
});
const indexedGroups = officialCalendarGroups(
  Object.freeze([deadline, indexedEvent, independent])
);
assert.equal(indexedGroups[0].item, indexedEvent);
assert.equal(indexedGroups[0].deadline, deadline);
assert.equal(indexedGroups[1].item, independent);

const loneEvent = Object.freeze({
  id: "single-event",
  title: topicTitle,
  schedule_kind: "event",
  registration_deadline_id: null,
  starts_at: "2026-10-24T01:00:00Z",
  ends_at: "2026-10-31T09:13:00Z",
  added: true,
});
const loneDeadline = Object.freeze({
  id: "single-deadline",
  title: topicTitle,
  schedule_kind: "deadline",
  starts_at: "2026-10-24T09:14:00Z",
  ends_at: "2026-10-24T09:14:00Z",
  busy: true,
});
for (const source of [
  Object.freeze([loneEvent, loneDeadline]),
  Object.freeze([loneDeadline, loneEvent]),
]) {
  const original = plain(source);
  const display = officialCalendarSummaryGroups(source);
  assert.equal(
    display.length,
    1,
    "A single post deadline uses the activity deadline cell"
  );
  assert.equal(display[0].item, loneEvent);
  assert.equal(display[0].deadline, loneDeadline);
  assert.equal(display[0].item.added, true);
  assert.equal(display[0].deadline.busy, true);
  assert.equal(
    officialCalendarGroups(source).length,
    2,
    "Editing keeps independent records"
  );
  assert.equal(calendarEditorSections(source).deadlines[0].related_event, "");
  assert.equal(
    canonicalCalendarItems(source).find(
      (item) => item.schedule_kind === "event"
    ).registration_deadline_index,
    null
  );
  assert.deepEqual(
    plain(source),
    original,
    "Display grouping must not write a relationship"
  );
}
for (const source of [
  [loneEvent],
  [loneDeadline],
  [loneEvent, loneDeadline, historical],
  [loneEvent, loneDeadline, independent],
  [{ ...loneEvent, registration_deadline_id: "missing" }, loneDeadline],
  [{ ...loneEvent, registration_deadline_index: 7 }, loneDeadline],
  [{ ...loneEvent, cancelled: true }, loneDeadline],
  [loneEvent, { ...loneDeadline, cancelled: true }],
]) {
  assert.deepEqual(
    plain(officialCalendarSummaryGroups(source)),
    plain(officialCalendarGroups(source)),
    "Ambiguous, missing or cancelled relationships keep their existing display"
  );
}
assert.deepEqual(plain(officialCalendarSummaryGroups(items)), plain(groups));
const linkedDisplay = officialCalendarSummaryGroups([
  { ...loneEvent, registration_deadline_id: loneDeadline.id },
  loneDeadline,
]);
assert.equal(linkedDisplay.length, 1);
assert.equal(linkedDisplay[0].deadline, loneDeadline);
assert.match(
  read("javascripts/discourse/components/isbf-official-activity-summary.gjs"),
  /officialCalendarSummaryGroups\(this\.args\.items\)/,
  "Feed and detail summaries must use display grouping"
);

process.stdout.write(
  "Official summary title, single-deadline display and immutable editor relationships passed\n"
);
