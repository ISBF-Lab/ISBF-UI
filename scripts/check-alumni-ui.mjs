import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const context = vm.createContext({});
const helpers = new vm.SourceTextModule(
  read("javascripts/discourse/lib/alumni.js"),
  { context },
);
await helpers.link(() => {});
await helpers.evaluate();
const { alumniConfig, alumniRegions, alumniCities, alumniLocation } =
  helpers.namespace;
const config = {
  enabled: true,
  geography_url: "/isbf/alumni/geography",
  countries: [
    {
      code: "CN",
      name: "中国",
      regions: [
        {
          code: "GD",
          name: "广东",
          cities: [{ code: "ZH", name: "珠海", lat: 22.27, lng: 113.57 }],
        },
      ],
    },
  ],
};
assert.equal(
  alumniConfig({ isbf_alumni: { ...config, enabled: false } }),
  null,
);
assert.equal(alumniConfig({ isbf_alumni: config }), config);
assert.equal(alumniRegions(config, "CN")[0].code, "GD");
assert.equal(alumniCities(config, "CN", "GD")[0].code, "ZH");
assert.equal(
  alumniLocation({
    country_name: "中国",
    region_name: "广东",
    city_name: "珠海",
  }),
  "中国 · 广东 · 珠海",
);

function componentClass(name, globals = {}) {
  const source = read(`javascripts/discourse/components/${name}.gjs`);
  const className = source.match(/export default class (\w+)/)[1];
  const body = source
    .slice(
      source.indexOf("export default class"),
      source.indexOf("  <template>"),
    )
    .replace("export default class", "class")
    .replace(/@service (\w+);/g, "$1;")
    .replace(/@tracked\s+/g, "")
    .replace(/  @action\r?\n/g, "");
  return vm.runInNewContext(`${body}}\n${className}`, {
    Component: class {
      constructor(args = {}) {
        this.args = args;
      }

      willDestroy() {}
    },
    ...globals,
  });
}

const pending = [];
const Page = componentClass("isbf-alumni", {
  alumniConfig,
  alumniRegions,
  alumniCities,
  alumniLocation,
  ajax: (url, options) =>
    new Promise((resolve, reject) =>
      pending.push({ url, options, resolve, reject }),
    ),
});
const page = new Page();
page.site = { isbf_alumni: config };
page.currentUser = { username: "member" };
page.geography = { countries: config.countries };
page.selectLocation({ country: "CN", region: "GD", city: "ZH" });
assert.deepEqual(plain(pending[0].options.data), {
  country: "CN",
  region: "GD",
  city: "ZH",
  page: 1,
});
page.selectLocation({ country: "US" });
pending[0].resolve({ users: [{ id: 1 }], has_more: true });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(page.users.length, 0);
assert.equal(page.loading, true);
pending[1].resolve({
  users: [
    { id: 2, username: "a", display_name: "A", country_name: "United States" },
  ],
  has_more: true,
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(page.users[0].id, 2);
assert.equal(page.loading, false);
const next = page.loadDirectory(true);
assert.equal(pending[2].options.data.page, 2);
await page.loadDirectory(true);
assert.equal(pending.length, 3);
pending[2].reject(new Error("offline"));
await next;
assert.equal(page.error, true);
assert.equal(page.users.length, 1);
page.retry();
assert.equal(pending[3].options.data.page, 2);
pending[3].resolve({ users: [{ id: 3 }], has_more: false });
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(plain(page.users.map((user) => user.id)), [2, 3]);
page.selectLocation({ country: "CN" });
page.willDestroy();
page.isDestroying = true;
pending[4].resolve({ users: [{ id: 4 }], has_more: true });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(page.users.length, 0);

let finishProfile;
let failProfile;
const requests = [];
const Profile = componentClass("isbf-alumni-profile", {
  alumniRegions,
  alumniCities,
  ajax: (url, options) =>
    new Promise((resolve, reject) => {
      requests.push({ url, options });
      finishProfile = resolve;
      failProfile = reject;
    }),
});
const profile = new Profile({ config, onSaved: () => {} });
profile.currentUser = { name: "Member", username: "member" };
failProfile(new Error("offline"));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(profile.disabled, true);
assert.equal(profile.error, true);
await profile.save({ preventDefault() {} });
assert.equal(requests.length, 1);
const reload = profile.load();
finishProfile({
  country_code: "CN",
  region_code: "GD",
  city_code: "ZH",
  industry: "Education",
  visible: true,
});
await reload;
assert.equal(profile.profile.display_name, "Member");
assert.equal(profile.disabled, false);
profile.change("country_code", { target: { value: "US" } });
assert.equal(profile.profile.region_code, "");
assert.equal(profile.profile.city_code, "");

const MapComponent = componentClass("isbf-alumni-map", {
  COUNTRY_VIEWS: {},
  leaflet: async () => {
    throw new Error("library offline");
  },
});
const map = new MapComponent({ config });
await map.initialize();
assert.equal(map.error, true);
assert.equal(map.loading, false);
map.willDestroy();
const mapSource = read("javascripts/discourse/components/isbf-alumni-map.gjs");
assert.ok(mapSource.includes("label.textContent"));
assert.ok(mapSource.includes("Natural Earth · Leaflet"));
assert.ok(!mapSource.includes("GeoNames"));
assert.ok(!mapSource.includes("https://"));
assert.ok(mapSource.includes("scrollWheelZoom: false"));
assert.ok(!mapSource.includes("htmlSafe") && !mapSource.includes("innerHTML"));
const pageSource = read("javascripts/discourse/components/isbf-alumni.gjs");
assert.ok(pageSource.includes("isbf_alumni_member"));
assert.ok(pageSource.includes("this.profileSaved"));
process.stdout.write(
  "Alumni capability, directory races/pagination, profile failures, safe labels and map initialization failure OK\n",
);
