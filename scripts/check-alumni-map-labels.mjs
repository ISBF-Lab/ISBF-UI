import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({});
const module = new vm.SourceTextModule(
  readFileSync(
    new URL(
      "../javascripts/discourse/lib/alumni-map-labels.js",
      import.meta.url
    ),
    "utf8"
  ),
  { context }
);
await module.link(() => {});
await module.evaluate();
const { visibleLabelLayers, labelFontSize } = module.namespace;
const plain = (value) => JSON.parse(JSON.stringify(value));
const size = { x: 200, y: 100 };
const candidate = (layer, left, top = 10, extra = {}) => ({
  layer,
  box: { left, right: left + 20, top, bottom: top + 20 },
  ...extra,
});
const visible = (items, exclusions = []) =>
  plain(visibleLabelLayers(items, size, exclusions));

assert.deepEqual(visible([candidate("a", 10), candidate("8px", 38)]), [
  "a",
  "8px",
]);
assert.deepEqual(visible([candidate("a", 10), candidate("7px", 37)]), ["a"]);
assert.deepEqual(
  visible([candidate("a", 10), candidate("vertical8", 10, 38)]),
  ["a", "vertical8"]
);
assert.deepEqual(
  visible([candidate("a", 10), candidate("vertical7", 10, 37)]),
  ["a"]
);
assert.deepEqual(visible([candidate("a", 10), candidate("diagonal", 36, 36)]), [
  "a",
  "diagonal",
]);
assert.deepEqual(
  visible([
    candidate("popular", 10, 10, { count: 100 }),
    candidate("selected", 10, 10, { selected: true, count: 1 }),
  ]),
  ["selected"]
);
assert.deepEqual(
  visible([
    candidate("low", 10, 10, { count: 1 }),
    candidate("high", 10, 10, { count: 2 }),
  ]),
  ["high"]
);
const control = { left: 10, right: 30, top: 10, bottom: 30 };
assert.deepEqual(
  visible([candidate("blocked", 37), candidate("safe", 100)], [control]),
  ["safe"]
);
assert.deepEqual(visible([candidate("boundary", 38)], [control]), ["boundary"]);
assert.deepEqual(
  visible([
    candidate("left", -1),
    candidate("top", 10, -1),
    candidate("right", 181),
    candidate("bottom", 10, 81),
    candidate("edge", 180, 80),
  ]),
  ["edge"]
);
for (const box of [
  null,
  {},
  { ...control, left: NaN },
  { ...control, right: Infinity },
  { ...control, right: 10 },
  { ...control, bottom: 9 },
]) {
  assert.deepEqual(visible([candidate("invalid", 10, 10, { box })]), []);
}
assert.deepEqual(visible([candidate("valid", 10)], [null, {}]), ["valid"]);
for (const viewport of [
  null,
  {},
  { x: 0, y: 100 },
  { x: NaN, y: 100 },
  { x: 100, y: -1 },
]) {
  assert.deepEqual(
    plain(visibleLabelLayers([candidate("a", 10)], viewport)),
    []
  );
}
const frozenBox = Object.freeze({ ...control });
const frozenItems = Object.freeze([
  Object.freeze(candidate("low", 10, 10, { box: frozenBox, count: 1 })),
  Object.freeze(
    candidate("selected", 10, 10, { box: frozenBox, selected: true })
  ),
]);
const before = JSON.stringify(frozenItems);
assert.deepEqual(plain(visibleLabelLayers(frozenItems, Object.freeze(size))), [
  "selected",
]);
assert.equal(JSON.stringify(frozenItems), before);
assert.deepEqual([0, 3, 4, 9, 20].map(labelFontSize), [10, 12, 13, 18, 18]);
console.log("Alumni map label geometry checks passed");
