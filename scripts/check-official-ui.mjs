import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const helper = new vm.SourceTextModule(
  readFileSync(
    new URL(
      "../javascripts/discourse/lib/official-filters.js",
      import.meta.url,
    ),
    "utf8",
  ),
);
await helper.link(() => {});
await helper.evaluate();
const {
  buildOfficialQuery,
  officialConfig,
  officialSelections,
  isOfficialComposer,
  restoreOfficialSelections,
  officialPayload,
  officialSelectionsComplete,
  officialLocationLabel,
  OfficialRequestGuard,
} = helper.namespace;
const config = {
  category_id: 6,
  campuses: [
    { id: "zhuhai", label: "珠海校区" },
    { id: "shenzhen", label: "深圳校区" },
  ],
  types: [
    { id: "academic", label: "教务" },
    { id: "clubs", label: "社团" },
  ],
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const model = (values) => ({
  ...values,
  set(key, value) {
    this[key] = value;
  },
});
assert.equal(officialConfig({}), null);
assert.equal(
  officialConfig({ isbf_official: { ...config, category_id: 0 } }),
  null,
);
assert.equal(officialConfig({ isbf_official: config }), config);
assert.equal(
  officialConfig({
    isbf_official: {
      ...config,
      campuses: [{ id: "x order:created", label: "bad" }],
    },
  }),
  null,
);
assert.equal(buildOfficialQuery(config), "isbf-official:6 order:activity");
assert.equal(
  buildOfficialQuery(config, "zhuhai", "academic"),
  "isbf-official:6 isbf-campus:zhuhai isbf-official-type:academic order:activity",
);
assert.equal(
  buildOfficialQuery(config, "", "clubs"),
  "isbf-official:6 isbf-official-type:clubs order:activity",
);
assert.equal(
  buildOfficialQuery(config, "invalid", "x"),
  "isbf-official:6 order:activity",
);
assert.deepEqual(
  plain(
    officialSelections(
      ["zhuhai", "zhuhai", "bad", "shenzhen"],
      config.campuses,
    ),
  ),
  ["zhuhai", "shenzhen"],
);
const fresh = model({ categoryId: 6, creatingTopic: true });
restoreOfficialSelections(fresh, config);
assert.equal(officialSelectionsComplete(fresh, config), false);
fresh.isbf_official_types = ["academic"];
assert.equal(
  officialSelectionsComplete(fresh, config),
  true,
  "Campus is optional",
);
assert.equal(officialPayload(fresh, config, "isbf_official_campuses"), "[]");
fresh.isbf_official_campuses = ["zhuhai", "shenzhen"];
fresh.isbf_official_types = ["academic", "clubs"];
assert.equal(officialSelectionsComplete(fresh, config), true);
assert.equal(
  officialPayload(fresh, config, "isbf_official_campuses"),
  '["zhuhai","shenzhen"]',
);
assert.equal(
  officialPayload(fresh, config, "isbf_official_types"),
  '["academic","clubs"]',
);
fresh.isbf_official_campuses = [];
assert.equal(officialSelectionsComplete(fresh, config), true);
assert.equal(officialPayload(fresh, config, "isbf_official_campuses"), "[]");
fresh.isbf_official_types = [];
assert.equal(
  officialSelectionsComplete(fresh, config),
  false,
  "Type remains required",
);
fresh.isbf_official_types = ["unknown"];
assert.equal(officialSelectionsComplete(fresh, config), false);
fresh.isbf_official_types = ["academic"];
for (const campuses of [[], ["zhuhai"]]) {
  for (const types of [undefined, null, [], ["unknown"]]) {
    assert.equal(
      officialSelectionsComplete(
        {
          ...fresh,
          isbf_official_campuses: campuses,
          isbf_official_types: types,
        },
        config,
      ),
      false,
      "A valid type is required regardless of campus selection",
    );
  }
}
const edited = model({
  categoryId: 6,
  editingFirstPost: true,
  topic: {
    isbf_official_campuses: ["shenzhen"],
    isbf_official_types: ["clubs"],
  },
});
restoreOfficialSelections(edited, config);
assert.deepEqual(plain(edited.isbf_official_campuses), ["shenzhen"]);
assert.deepEqual(plain(edited.isbf_official_types), ["clubs"]);
const draft = model({
  ...edited,
  isbf_official_campuses: [],
  isbf_official_types: ["academic"],
});
restoreOfficialSelections(draft, config);
assert.deepEqual(plain(draft.isbf_official_campuses), []);
assert.deepEqual(plain(draft.isbf_official_types), ["academic"]);
assert.equal(officialSelectionsComplete(draft, config), true);
assert.equal(officialPayload(draft, config, "isbf_official_campuses"), "[]");
const cleared = model({
  categoryId: 6,
  editingFirstPost: true,
  post: { isbf_official_campuses: [], isbf_official_types: ["clubs"] },
  topic: edited.topic,
});
restoreOfficialSelections(cleared, config);
assert.deepEqual(plain(cleared.isbf_official_campuses), []);
assert.equal(officialPayload(cleared, config, "isbf_official_campuses"), "[]");
assert.equal(officialSelectionsComplete(cleared, config), true);
const postHydration = model({
  categoryId: 6,
  editingFirstPost: true,
  post: {
    isbf_official_campuses: ["zhuhai"],
    isbf_official_types: ["academic"],
  },
  topic: edited.topic,
});
restoreOfficialSelections(postHydration, config);
assert.deepEqual(plain(postHydration.isbf_official_campuses), ["zhuhai"]);
for (const excluded of [
  { ...fresh, categoryId: 2 },
  { ...fresh, creatingTopic: false },
  { ...fresh, archetypeId: "private_message" },
  { ...edited, topic: { archetype: "private_message" } },
  { ...fresh, creatingPrivateMessage: true },
]) {
  assert.equal(isOfficialComposer(excluded, config), false);
  assert.equal(
    officialPayload(excluded, config, "isbf_official_campuses"),
    undefined,
  );
}
for (const [location, campusIds, catalog, separator, expected] of [
  ["  教学楼 101  ", ["zhuhai"], config, undefined, "珠海校区 · 教学楼 101"],
  [
    "Hall",
    ["shenzhen", "zhuhai"],
    config,
    undefined,
    "珠海校区、深圳校区 · Hall",
  ],
  [
    "Hall",
    ["shenzhen", "unknown", "zhuhai", "shenzhen"],
    config,
    " / ",
    "珠海校区 / 深圳校区 · Hall",
  ],
  ["  Hall  ", [], config, undefined, "Hall"],
  ["Hall", ["unknown"], config, undefined, "Hall"],
  ["", ["zhuhai"], config, undefined, "珠海校区"],
  [undefined, ["shenzhen"], config, undefined, "深圳校区"],
  [null, ["zhuhai"], config, undefined, "珠海校区"],
  ["  ", [], config, undefined, ""],
  [undefined, undefined, undefined, undefined, ""],
  ["Hall", ["zhuhai"], null, undefined, "Hall"],
  ["Hall", ["zhuhai"], {}, undefined, "Hall"],
  ["Hall", undefined, config, undefined, "Hall"],
]) {
  const input = [location, campusIds, catalog];
  const original = structuredClone(input);
  assert.equal(
    officialLocationLabel(location, campusIds, catalog, separator),
    expected,
  );
  assert.deepEqual(
    input,
    original,
    "Location formatting does not mutate persisted values or catalog",
  );
}
const guard = new OfficialRequestGuard();
const first = guard.next();
let completeOld;
const oldResponse = new Promise((resolve) => {
  completeOld = resolve;
});
let visible = [];
const oldLoad = oldResponse.then((topics) => {
  if (guard.isCurrent(first)) {
    visible = topics;
  }
});
const latest = guard.next();
if (guard.isCurrent(latest)) {
  visible = [2];
}
completeOld([1]);
await oldLoad;
assert.deepEqual(visible, [2]);
guard.next();
assert.equal(guard.isCurrent(latest), false);
process.stdout.write(
  "Official filters, optional campuses, required type, location labels, draft/edit hydration and stale-response guard OK\n",
);
