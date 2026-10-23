import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const helper = new vm.SourceTextModule(
  read("javascripts/discourse/lib/alumni-distribution.js")
);
await helper.link(() => {});
await helper.evaluate();
const { distributionBin, distributionCounts, distributionCities, cityRadius } =
  helper.namespace;
assert.deepEqual(
  [0, 1, 5, 6, 10, 11, 20, 21, 1000].map(distributionBin),
  [0, 1, 1, 2, 2, 3, 3, 4, 4]
);
for (const invalid of [null, undefined, -1, "5", NaN, Infinity, 1.5]) {
  assert.equal(distributionBin(invalid), null);
}
const payload = {
  country: "CN",
  region: "GD",
  countries: [{ code: "CN", count: 22 }],
  regions: [{ code: "GD", count: 5 }],
  cities: [
    { code: "SZ", count: 4 },
    { code: "GZ", count: 1 },
    { code: "MISSING", count: 2 },
    { code: "BAD", count: 3 },
  ],
};
const counts = distributionCounts(payload, "CN", "GD");
assert.equal(counts.regions.get("GD"), 5);
assert.equal(counts.cities.get("NO_SUCH_CITY"), undefined);
assert.equal(distributionCounts(null, "CN", "GD"), null);
assert.equal(distributionCounts(payload, "CN", "BJ"), null);
assert.equal(distributionCounts(payload, "US", "GD"), null);
const empty = {
  country: null,
  region: null,
  countries: [],
  regions: [],
  cities: [],
};
assert.ok(distributionCounts(empty, "", ""));
assert.equal(distributionCounts({ country: null, region: null }, "", ""), null);
for (const row of [
  null,
  {},
  { code: "", count: 1 },
  { code: " ", count: 1 },
  { code: 12, count: 1 },
  { code: "GD", count: -1 },
  { code: "GD", count: 1.5 },
  { code: "GD", count: "5" },
]) {
  assert.equal(distributionCounts({ ...empty, regions: [row] }, "", ""), null);
}
for (const field of ["countries", "regions", "cities"]) {
  assert.equal(distributionCounts({ ...empty, [field]: null }, "", ""), null);
  assert.equal(
    distributionCounts(
      {
        ...empty,
        [field]: [
          { code: "duplicate", count: 1 },
          { code: "duplicate", count: 2 },
        ],
      },
      "",
      ""
    ),
    null
  );
}
const config = {
  countries: [
    {
      code: "CN",
      regions: [
        {
          code: "GD",
          cities: [
            { code: "SZ", lat: 22.54, lng: 114.06 },
            { code: "GZ", lat: 23.13, lng: 113.26 },
            { code: "BAD", lat: 91, lng: 113 },
            { code: "EMPTY", lat: 22, lng: 113 },
          ],
        },
      ],
    },
  ],
};
assert.deepEqual(
  Array.from(
    distributionCities(config, "CN", "GD", counts),
    (item) => item.code
  ),
  ["SZ", "GZ"]
);
assert.equal(distributionCities(config, "US", "GD", counts).length, 0);
assert.equal(distributionCities(config, "CN", "", counts).length, 0);
assert.equal(distributionCities(config, "CN", "GD", null).length, 0);
assert.equal(cityRadius(0), 0);
assert.equal(cityRadius(-1), 0);
assert.equal(cityRadius(1), 7);
assert.equal(cityRadius(100000), 18);
assert.ok(cityRadius(5) > cityRadius(1));
const source = read("javascripts/discourse/components/isbf-alumni-map.gjs");
const refresh = source.slice(
  source.indexOf("  updateDistribution()"),
  source.indexOf("  #accessibleLayer")
);
assert.ok(!refresh.includes("setView") && !refresh.includes("fitBounds"));
assert.ok(source.includes("label.textContent"));
assert.ok(source.includes('class="isbf-alumni-map__legend-title"'));
assert.ok(
  source.includes(
    'classList.toggle("isbf-alumni-map__selected-region", selected)'
  )
);
assert.ok(
  source.includes('event.key === "Enter"') &&
    source.includes('event.key === "Escape"')
);
assert.ok(!source.includes("innerHTML") && !source.includes("htmlSafe"));
console.log(
  "Alumni distribution bins, context isolation, city-coordinate bounds, unknown data and bounded marker sizes OK"
);
