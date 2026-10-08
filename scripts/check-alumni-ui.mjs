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
const { alumniConfig, alumniRegions, alumniLocation } = helpers.namespace;
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
          name: "广东省",
          center: { lat: 23, lng: 113 },
        },
        {
          code: "HK",
          name: "香港特别行政区",
          center: { lat: 22.3, lng: 114.2 },
        },
        {
          code: "MO",
          name: "澳门特别行政区",
          center: { lat: 22.2, lng: 113.5 },
        },
        {
          code: "INVALID",
          name: "Invalid center",
          center: { lat: null, lng: 1 },
        },
      ],
    },
    { code: "US", name: "美国", regions: [{ code: "CA", name: "California" }] },
  ],
};
assert.equal(
  alumniConfig({ isbf_alumni: { ...config, enabled: false } }),
  null,
);
assert.equal(alumniConfig({ isbf_alumni: config }), config);
assert.equal(alumniRegions(config, "CN")[0].code, "GD");
assert.deepEqual(plain(alumniRegions(config, "US")), []);
assert.equal(
  alumniLocation({
    country_code: "CN",
    country_name: "中国",
    region_name: "广东省",
    city_name: "珠海",
  }),
  "中国 · 广东省",
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
  page: 1,
});
page.selectLocation({ country: "US", region: "CA" });
assert.equal(page.region, "");
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
assert.equal(profile.profile.city_code, undefined);
const save = profile.save({ preventDefault() {} });
assert.deepEqual(plain(requests.at(-1).options.data), {
  display_name: "Member",
  country_code: "US",
  region_code: "",
  industry: "Education",
  visible: true,
});
finishProfile({});
await save;

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
const selections = [];
const markers = [];
const mapRequests = [];
const featureLayers = [];
const bounds = {
  getNorthWest: () => ({ x: 0, y: 0 }),
  getSouthEast: () => ({ x: 100, y: 50 }),
  intersects: () => true,
};
const fakeMap = {
  setView(center, zoom) {
    this.center = center;
    this.zoom = zoom;
    return this;
  },
  fitBounds() {},
  getBounds: () => bounds,
  getZoom() {
    return this.zoom;
  },
  latLngToContainerPoint: (point) => point,
  on() {},
  remove() {},
  invalidateSize() {},
};
const L = {
  map: () => fakeMap,
  geoJSON(data, options) {
    const layers = data.features.map((feature) => {
      const layer = {
        feature,
        bindTooltip(label) {
          this.label = label.textContent;
        },
        on(event, callback) {
          this[event] = callback;
        },
        getBounds: () => bounds,
        setStyle() {},
        openTooltip() {},
        closeTooltip() {},
      };
      featureLayers.push(layer);
      options.onEachFeature(feature, layer);
      return layer;
    });
    return {
      eachLayer(callback) {
        layers.forEach(callback);
      },
      addTo() {
        return this;
      },
      remove() {},
    };
  },
  circleMarker(center, options) {
    const marker = {
      center,
      options,
      bindTooltip(label, tooltipOptions) {
        this.label = label.textContent;
        this.tooltipOptions = tooltipOptions;
      },
      on(event, callback) {
        this[event] = callback;
      },
    };
    markers.push(marker);
    return marker;
  },
  layerGroup(items) {
    return {
      items,
      addTo() {
        this.visible = true;
        return this;
      },
      remove() {
        this.visible = false;
      },
    };
  },
};
const workingConfig = {
  ...config,
  world_map_url: "/world.json",
  region_map_urls: { CN: "/cn.json", US: "/us.json" },
};
const WorkingMap = componentClass("isbf-alumni-map", {
  COUNTRY_VIEWS: { CN: { center: [35, 105], zoom: 3 } },
  leaflet: async () => L,
  window: { L },
  document: { createElement: () => ({}) },
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  sameOriginPath: (url) => url,
  ajax: async (url) => {
    mapRequests.push(url);
    return {
      features: (url === "/world.json"
        ? [
            { code: "CN", name: "中国" },
            { code: "US", name: "美国" },
          ]
        : [{ code: "GD", name: "广东省" }]
      ).map((properties) => ({ properties })),
    };
  },
});
const workingMap = new WorkingMap({
  config: workingConfig,
  country: "CN",
  region: "",
  onSelect: (value) => selections.push(value),
});
await workingMap.initialize();
assert.equal(workingMap.error, false);
assert.deepEqual(plain(markers.map((item) => item.label)), [
  "香港特别行政区",
  "澳门特别行政区",
]);
assert.ok(markers.every((item) => item.tooltipOptions.permanent));
markers[0].click();
assert.deepEqual(plain(selections.at(-1)), { country: "CN", region: "HK" });
featureLayers.find((item) => item.feature.properties.code === "GD").click();
assert.deepEqual(plain(selections.at(-1)), { country: "CN", region: "GD" });
workingMap.args.region = "HK";
await workingMap.updateSelection();
assert.deepEqual(plain(fakeMap.center), [22.3, 114.2]);
assert.equal(fakeMap.zoom, 7);
workingMap.args.country = "US";
workingMap.args.region = "";
await workingMap.updateSelection();
assert.deepEqual(mapRequests, ["/world.json", "/cn.json"]);
workingMap.returnToChina();
assert.deepEqual(plain(selections.at(-1)), { country: "CN" });
workingMap.willDestroy();
assert.equal(
  alumniLocation({
    country_code: "US",
    country_name: "美国",
    region_name: "California",
    city_name: "LA",
  }),
  "美国",
);

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
  "Alumni capability, directory races/pagination, profile failures, safe labels and country/province marker selection and map initialization failure OK\n",
);
