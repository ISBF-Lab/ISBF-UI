import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const context = vm.createContext({});
const helpers = new vm.SourceTextModule(
  read("javascripts/discourse/lib/alumni.js"),
  { context }
);
await helpers.link(() => {});
await helpers.evaluate();
const { alumniConfig, alumniRegions, alumniCities, alumniLocation } =
  helpers.namespace;
const labels = new vm.SourceTextModule(
  read("javascripts/discourse/lib/alumni-map-labels.js"),
  { context }
);
await labels.link(() => {});
await labels.evaluate();
const { labelFontSize, visibleLabelLayers } = labels.namespace;
assert.deepEqual([0, 3, 4, 9, 20].map(labelFontSize), [10, 12, 13, 18, 18]);
const box = { left: 10, right: 70, top: 10, bottom: 30 };
assert.deepEqual(
  plain(
    visibleLabelLayers(
      [
        { layer: "province", box },
        { layer: "selected marker", box, selected: true },
        { layer: "separate", box: { ...box, left: 80, right: 140 } },
        { layer: "outside", box: { ...box, left: -10 } },
      ],
      { x: 200, y: 100 }
    )
  ),
  ["selected marker", "separate"]
);
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
          name: "中国香港",
          center: { lat: 22.3, lng: 114.2 },
        },
        {
          code: "MO",
          name: "中国澳门",
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
  null
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
  "中国 · 广东省 · 珠海"
);

const distributionModule = new vm.SourceTextModule(
  read("javascripts/discourse/lib/alumni-distribution.js"),
  { context }
);
await distributionModule.link(() => {});
await distributionModule.evaluate();

function componentClass(name, globals = {}) {
  const source = read(`javascripts/discourse/components/${name}.gjs`);
  const className = source.match(/export default class (\w+)/)[1];
  const body = source
    .slice(
      source.indexOf("export default class"),
      source.indexOf("  <template>")
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
    ...distributionModule.namespace,
    ...globals,
  });
}

const pending = [];
const distributions = [];
const tick = () => new Promise((resolve) => setImmediate(resolve));
const distributionResponse = (country, region, count = 1) => ({
  country,
  region,
  total: count,
  countries: [{ code: country || "CN", count }],
  regions: region ? [{ code: region, count }] : [],
  cities: [],
});
const Page = componentClass("isbf-alumni", {
  alumniConfig,
  alumniRegions,
  alumniLocation,
  ajax: (url, options) =>
    new Promise((resolve, reject) => {
      const queue =
        url === "/isbf/alumni/distribution" ? distributions : pending;
      queue.push({ url, options, resolve, reject });
    }),
});
const page = new Page();
page.site = { isbf_alumni: config };
page.currentUser = { id: 1, username: "member" };
page.geography = { countries: config.countries };
page.selectLocation({ country: "CN", region: "GD", city: "ZH" });
assert.deepEqual(plain(pending[0].options.data), {
  country: "CN",
  region: "GD",
  page: 1,
});
assert.deepEqual(plain(distributions[0].options.data), {
  country: "CN",
  region: "GD",
});
page.selectLocation({ country: "US", region: "CA" });
assert.equal(page.region, "");
pending[0].resolve({ users: [{ id: 1 }], has_more: true });
distributions[0].resolve(distributionResponse("CN", "GD", 9));
await tick();
assert.equal(page.users.length, 0);
assert.equal(page.loading, true);
assert.equal(page.distribution, null);
assert.equal(page.distributionLoading, true);
pending[1].resolve({
  users: [
    { id: 2, username: "a", display_name: "A", country_name: "United States" },
  ],
  has_more: true,
});
distributions[1].resolve(distributionResponse("US", "", 3));
await tick();
assert.equal(page.users[0].id, 2);
assert.equal(page.loading, false);
assert.equal(page.distribution.total, 3);
assert.equal(page.distributionLoading, false);
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
await tick();
assert.deepEqual(plain(page.users.map((user) => user.id)), [2, 3]);
const failedRefresh = page.loadDistribution();
assert.equal(page.distribution.total, 3);
distributions[2].reject(new Error("offline"));
await failedRefresh;
assert.equal(page.distributionError, true);
assert.equal(page.distribution.total, 3);
const duplicateFirst = page.loadDistribution();
const duplicateSecond = page.loadDistribution();
assert.equal(distributions.length, 4);
distributions[3].resolve(distributionResponse("US", "", 4));
await Promise.all([duplicateFirst, duplicateSecond]);
assert.equal(page.distribution.total, 4);
assert.equal(page.distributionError, false);
const wrongContext = page.loadDistribution();
distributions[4].resolve(distributionResponse("CN", "", 99));
await wrongContext;
assert.equal(page.distributionError, true);
assert.equal(page.distribution.total, 4);
page.profileSaved();
assert.equal(page.distribution, null);
assert.equal(page.distributionLoading, true);
pending[4].resolve({ users: [], has_more: false });
distributions[5].resolve(distributionResponse("US", "", 5));
await tick();
assert.equal(page.distribution.total, 5);
const formerAccount = page.loadDistribution();
page.currentUser = { id: 2, username: "another" };
page.accountChanged();
assert.equal(page.distribution, null);
assert.equal(page.users.length, 0);
distributions[6].resolve(distributionResponse("US", "", 99));
await formerAccount;
assert.equal(page.distribution, null);
distributions[7].resolve(distributionResponse("US", "", 2));
pending[5].resolve({ users: [{ id: 8 }], has_more: false });
await tick();
assert.equal(page.distribution.total, 2);
assert.equal(page.users[0].id, 8);
const lateDirectory = page.loadDirectory();
const lateDistribution = page.loadDistribution();
page.currentUser = null;
page.accountChanged();
assert.equal(page.distribution, null);
assert.equal(page.users.length, 0);
assert.equal(page.distributionLoading, false);
pending[6].resolve({ users: [{ id: 9 }], has_more: false });
distributions[8].resolve(distributionResponse("US", "", 99));
await Promise.all([lateDirectory, lateDistribution]);
assert.equal(page.users.length, 0);
assert.equal(page.distribution, null);
page.currentUser = { id: 3 };
page.selectLocation({ country: "CN" });
page.willDestroy();
page.isDestroying = true;
pending[7].resolve({ users: [{ id: 4 }], has_more: true });
distributions[9].resolve(distributionResponse("CN", "", 20));
await tick();
assert.equal(page.users.length, 0);
assert.equal(page.distribution, null);

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
assert.equal(profile.profile.city_name, "");
const save = profile.save({ preventDefault() {} });
assert.deepEqual(plain(requests.at(-1).options.data), {
  display_name: "Member",
  country_code: "US",
  region_code: "",
  city_code: "",
  city_name: "",
  bio: "",
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
const groups = [];
let disconnected = false;
const mapEvents = {};
const bounds = {
  getNorthWest: () => ({ x: 0, y: 0 }),
  getSouthEast: () => ({ x: 100, y: 50 }),
  intersects: () => true,
  contains: () => true,
};
const fakeMap = {
  setView(center, zoom) {
    this.center = center;
    this.zoom = zoom;
    return this;
  },
  fitBounds() {
    this.zoom = 6;
  },
  getBounds: () => bounds,
  getZoom() {
    return this.zoom;
  },
  getSize: () => ({ x: 600, y: 360 }),
  latLngToContainerPoint: () => ({ x: 150, y: 150 }),
  on(events, callback) {
    events.split(" ").forEach((event) => {
      mapEvents[event] = callback;
    });
  },
  remove() {
    this.removed = true;
  },
  invalidateSize() {},
};
function pathElement() {
  const classes = new Set();
  const attributes = new Map();
  return {
    classes,
    attributes,
    classList: {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      toggle: (value, enabled) =>
        enabled ? classes.add(value) : classes.delete(value),
    },
    setAttribute: (name, value) => attributes.set(name, value),
  };
}
const L = {
  map: () => fakeMap,
  geoJSON(data, options) {
    const layers = data.features.map((feature) => {
      const element = pathElement();
      const layer = {
        feature,
        getElement: () => element,
        bindTooltip(label, tooltipOptions) {
          this.label = label.textContent;
          this.tooltipOptions = tooltipOptions;
          this.tooltip = { getContent: () => label };
        },
        on(event, callback) {
          this[event] = callback;
        },
        getBounds: () => bounds,
        getCenter: () => ({ lat: 23, lng: 113 }),
        getTooltip() {
          return this.tooltip;
        },
        setStyle() {},
        openTooltip() {
          this.open = true;
        },
        closeTooltip() {
          this.open = false;
        },
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
        this.tooltip = { getContent: () => label };
      },
      getTooltip() {
        return this.tooltip;
      },
      getLatLng: () => ({ lat: center[0], lng: center[1] }),
      openTooltip() {
        this.open = true;
      },
      closeTooltip() {
        this.open = false;
      },
      on(event, callback) {
        this[event] = callback;
      },
    };
    markers.push(marker);
    return marker;
  },
  layerGroup(items) {
    const group = {
      items,
      eachLayer(callback) {
        items.forEach(callback);
      },
      addTo() {
        this.visible = true;
        return this;
      },
      remove() {
        this.visible = false;
        items.forEach((item) => item.closeTooltip());
      },
    };
    groups.push(group);
    return group;
  },
};
const workingConfig = {
  ...config,
  world_map_url: "/world.json",
  region_map_urls: { CN: "/cn.json", US: "/us.json" },
};
const WorkingMap = componentClass("isbf-alumni-map", {
  COUNTRY_VIEWS: { CN: { center: [35, 105], zoom: 3 } },
  labelFontSize,
  visibleLabelLayers,
  i18n: (_key, values) => `${values.name} · ${values.count}人`,
  themePrefix: (key) => key,
  leaflet: async () => L,
  window: { L },
  document: {
    createElement: () => ({
      getContext: () => ({
        measureText: (name) => ({ width: name.length * 13 }),
      }),
    }),
  },
  ResizeObserver: class {
    observe() {}
    disconnect() {
      disconnected = true;
    }
  },
  sameOriginPath: (url) => url,
  ajax: async (url) => {
    mapRequests.push(url);
    return {
      features: (url === "/world.json"
        ? [
            { code: "CN", name: "中国" },
            { code: "US", name: "美国" },
            { code: "TW", name: "Taiwan" },
            { code: "XK", name: "Kosovo" },
            { code: "EH", name: "Western Sahara" },
          ]
        : [
            { code: "GD", name: "广东省" },
            { code: "TW", name: "台湾省" },
          ]
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
const labelSizes = [];
workingMap.insert({
  style: { setProperty: (name, value) => labelSizes.push(value) },
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(workingMap.error, false);
assert.deepEqual(plain(markers.map((item) => item.label)), [
  "中国香港",
  "中国澳门",
]);
assert.ok(markers.every((item) => item.tooltipOptions.permanent === false));
assert.ok(markers.every((item) => !item.open));
assert.equal(labelSizes.at(-1), "12px");
assert.ok(
  featureLayers
    .filter(
      (item) =>
        ["US", "TW", "XK", "EH"].includes(item.feature.properties.code) &&
        item.label !== "台湾省"
    )
    .every((item) => !item.tooltip)
);
assert.ok(
  featureLayers
    .filter(
      (item) =>
        ["TW", "XK", "EH"].includes(item.feature.properties.code) &&
        item.label !== "台湾省"
    )
    .every((item) => !item.click)
);
featureLayers.find((item) => item.feature.properties.code === "US").click();
assert.deepEqual(plain(selections.at(-1)), { country: "US" });
fakeMap.zoom = 4;
mapEvents.zoomend();
assert.equal(labelSizes.at(-1), "13px");
assert.equal(
  [...featureLayers, ...markers].filter((item) => item.open).length,
  1
);
markers[0].openTooltip();
fakeMap.zoom = 3;
mapEvents.zoomend();
assert.ok([...featureLayers, ...markers].every((item) => !item.open));
markers[0].openTooltip();
assert.equal(markers[0].open, true);
markers[0].mouseout();
assert.equal(markers[0].open, false);
markers[0].click();
assert.deepEqual(plain(selections.at(-1)), { country: "CN", region: "HK" });
featureLayers.find((item) => item.feature.properties.code === "GD").click();
assert.deepEqual(plain(selections.at(-1)), { country: "CN", region: "GD" });
featureLayers.find((item) => item.label === "台湾省").click();
assert.deepEqual(plain(selections.at(-1)), { country: "CN", region: "TW" });
markers[1].click();
assert.deepEqual(plain(selections.at(-1)), { country: "CN", region: "MO" });
workingMap.args.region = "HK";
await workingMap.updateSelection();
assert.deepEqual(plain(fakeMap.center), [22.3, 114.2]);
assert.equal(fakeMap.zoom, 7);
assert.equal(markers.at(-2).open, true);
assert.equal(markers.at(-1).open, false);
assert.equal(groups[0].visible, false);
workingMap.args.country = "US";
workingMap.args.region = "";
await workingMap.updateSelection();
assert.deepEqual(mapRequests, ["/world.json", "/cn.json"]);
workingMap.returnToChina();
assert.deepEqual(plain(selections.at(-1)), { country: "CN" });
workingMap.args.country = "CN";
workingMap.args.region = "GD";
workingConfig.countries[0].regions[0].cities = [
  { code: "SZ", name: "深圳市", lat: 22.54, lng: 114.06 },
];
await workingMap.updateSelection();
const viewBeforeDistribution = { center: fakeMap.center, zoom: fakeMap.zoom };
workingMap.args.distribution = {
  country: "CN",
  region: "GD",
  countries: [{ code: "CN", count: 5 }],
  regions: [{ code: "GD", count: 5 }],
  cities: [{ code: "SZ", count: 4 }],
};
workingMap.updateDistribution();
assert.deepEqual(
  { center: fakeMap.center, zoom: fakeMap.zoom },
  viewBeforeDistribution
);
assert.equal(markers.at(-1).label, "深圳市 · 4人");
assert.equal(markers.at(-1).options.radius, 9);
assert.equal(markers.at(-1).options.cityCode, "SZ");
assert.equal(markers.at(-1).options.distributionCount, 4);
const selectedProvince = featureLayers
  .filter((layer) => layer.feature.properties.code === "GD")
  .at(-1);
assert.ok(
  selectedProvince.getElement().classes.has("isbf-alumni-map__selected-region")
);
assert.equal(
  selectedProvince.getElement().attributes.get("aria-pressed"),
  "true"
);
assert.ok(selectedProvince.getElement().classes.has("isbf-alumni-map__bin-1"));
assert.ok(featureLayers.some((layer) => layer.label === "广东省 · 5人"));
const countBeforeCityClick = selections.length;
markers.at(-1).click();
assert.equal(markers.at(-1).open, true);
assert.equal(selections.length, countBeforeCityClick);
workingMap.args.distribution = {
  ...workingMap.args.distribution,
  region: "BJ",
};
workingMap.updateDistribution();
assert.equal(workingMap.distributionReady, false);
assert.equal(groups.at(-1).visible, false);
workingMap.willDestroy();
assert.equal(fakeMap.removed, true);
assert.equal(disconnected, true);
assert.equal(
  alumniLocation({
    country_code: "US",
    country_name: "美国",
    region_name: "California",
    city_name: "LA",
  }),
  "美国 · LA"
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
  "Alumni capability, directory races/pagination, profile failures, China-only labels, zoom threshold/font bounds, collision priority, TW/HK/MO selection, cleanup and map initialization failure OK\n"
);

assert.equal(
  alumniLocation({
    country_name: "中国",
    country_code: "CN",
    region_name: "上海",
    city_name: "上海",
  }),
  "中国 · 上海"
);
assert.equal(
  alumniLocation({
    country_name: "美国",
    country_code: "US",
    city_name: "New York",
  }),
  "美国 · New York"
);
assert.deepEqual(
  plain(
    alumniCities(
      { cities: { GD: [{ code: "4403", name: "深圳市" }] } },
      "CN",
      "GD"
    )
  ),
  [{ code: "4403", name: "深圳市" }]
);
assert.deepEqual(plain(alumniCities(config, "US", "CA")), []);
profile.profile = {
  ...profile.profile,
  country_code: "CN",
  region_code: "GD",
  city_code: "4403",
  city_name: "深圳市",
};
profile.change("region_code", { target: { value: "JS" } });
assert.equal(profile.profile.city_code, "");
assert.equal(profile.profile.city_name, "");
assert.match(
  read("javascripts/discourse/components/isbf-alumni-profile.gjs"),
  /maxlength="500"/
);
assert.match(
  read("javascripts/discourse/components/isbf-alumni.gjs"),
  /{{user.bio}}/
);
