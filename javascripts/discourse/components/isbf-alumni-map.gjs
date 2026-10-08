import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import didUpdate from "@ember/render-modifiers/modifiers/did-update";
import { themePrefix } from "virtual:theme";
import { ajax } from "discourse/lib/ajax";
import loadScript from "discourse/lib/load-script";
import DButton from "discourse/ui-kit/d-button";
import { i18n } from "discourse-i18n";

let leafletPromise;
const COUNTRY_VIEWS = {
  CN: { center: [35, 105], zoom: 3 },
  US: { center: [39, -98], zoom: 3 },
  CA: { center: [57, -106], zoom: 3 },
  GB: { center: [55, -3], zoom: 5 },
  AU: { center: [-25, 134], zoom: 3 },
  JP: { center: [37, 138], zoom: 4 },
  DE: { center: [51, 10], zoom: 5 },
  FR: { center: [47, 2], zoom: 5 },
};

function sameOriginPath(url) {
  return typeof url === "string" && /^\/(?!\/)/.test(url) && !url.includes("\\")
    ? url
    : null;
}

function leaflet(config) {
  const script = sameOriginPath(config.leaflet_js_url);
  const stylesheet = sameOriginPath(config.leaflet_css_url);
  if (!script || !stylesheet) {
    throw new Error("Missing map assets");
  }
  if (!leafletPromise) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = stylesheet;
    document.head.appendChild(link);
    leafletPromise = loadScript(script)
      .then(() => {
        if (!window.L) {
          throw new Error("Missing map library");
        }
        return window.L;
      })
      .catch((error) => {
        leafletPromise = null;
        link.remove();
        throw error;
      });
  }
  return leafletPromise;
}

export default class ISBFAlumniMap extends Component {
  @tracked loading = true;
  @tracked error = false;

  #element;
  #map;
  #world;
  #detail;
  #cities;
  #observer;
  #request = 0;
  #layers = new Map();

  willDestroy() {
    super.willDestroy(...arguments);
    this.#request++;
    this.#observer?.disconnect();
    this.#map?.remove();
  }

  @action
  insert(element) {
    this.#element = element;
    this.initialize();
  }

  @action
  async initialize() {
    const request = ++this.#request;
    this.error = false;
    this.loading = true;
    try {
      const L = await leaflet(this.args.config);
      const data = await this.#loadLayer(this.args.config.world_map_url);
      if (request !== this.#request || this.isDestroying) {
        return;
      }
      this.#map?.remove();
      this.#map = L.map(this.#element, {
        scrollWheelZoom: false,
        attributionControl: false,
        minZoom: 1,
        maxZoom: 9,
        worldCopyJump: true,
      }).setView([35, 105], 3);
      this.#world = L.geoJSON(data, {
        style: { className: "isbf-alumni-map__country", weight: 1 },
        onEachFeature: (feature, layer) => {
          const code =
            feature.properties.country_code || feature.properties.code;
          const name = feature.properties.name;
          layer.bindTooltip(this.#label(name));
          layer.on("click", () => this.args.onSelect({ country: code }));
        },
      }).addTo(this.#map);
      this.#map.on("zoomend moveend", () => this.#refreshLabels());
      this.#observer?.disconnect();
      this.#observer = new ResizeObserver(() => this.#map?.invalidateSize());
      this.#observer.observe(this.#element);
      this.loading = false;
      await this.updateSelection();
    } catch {
      if (request === this.#request && !this.isDestroying) {
        this.error = true;
      }
    } finally {
      if (request === this.#request && !this.isDestroying) {
        this.loading = false;
      }
    }
  }

  @action
  returnToChina() {
    if (this.args.country === "CN" && !this.args.region && !this.args.city) {
      this.updateSelection();
    } else {
      this.args.onSelect({ country: "CN" });
    }
  }

  @action
  async updateSelection() {
    if (!this.#map) {
      return;
    }
    const request = ++this.#request;
    this.#detail?.remove();
    this.#cities?.remove();
    this.#detail = null;
    this.#cities = null;
    this.error = false;
    const country = this.args.country;
    const region = this.args.region;
    const city = this.args.city;
    let countryLayer;
    this.#world.eachLayer((layer) => {
      const code =
        layer.feature.properties.country_code || layer.feature.properties.code;
      layer.setStyle({
        className: "isbf-alumni-map__country",
        fillOpacity: code === country ? 0.45 : 0.15,
      });
      if (code === country) {
        countryLayer = layer;
      }
    });
    const view = COUNTRY_VIEWS[country];
    if (view) {
      this.#map.setView(view.center, view.zoom);
    } else if (countryLayer) {
      this.#map.fitBounds(countryLayer.getBounds(), {
        padding: [20, 20],
        maxZoom: 4,
      });
    } else if (!country) {
      this.#map.setView([20, 0], 1);
    }
    const url = this.args.config.region_map_urls?.[country];
    if (!url) {
      this.#refreshLabels();
      return;
    }
    try {
      const data = await this.#loadLayer(url);
      if (request !== this.#request || this.isDestroying) {
        return;
      }
      const L = window.L;
      this.#detail = L.geoJSON(data, {
        style: (feature) => ({
          className: "isbf-alumni-map__region",
          weight: 1,
          fillOpacity: feature.properties.code === region ? 0.55 : 0.2,
        }),
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(this.#label(feature.properties.name));
          layer.on("click", () =>
            this.args.onSelect({ country, region: feature.properties.code }),
          );
          if (feature.properties.code === region) {
            this.#map.fitBounds(layer.getBounds(), {
              padding: [20, 20],
              maxZoom: 6,
            });
          }
        },
      }).addTo(this.#map);
      const regions =
        this.args.config.countries.find((item) => item.code === country)
          ?.regions || [];
      const points = regions
        .filter((item) => !region || item.code === region)
        .flatMap((item) =>
          (item.cities || []).map((point) => ({ ...point, region: item.code })),
        );
      this.#cities = L.layerGroup(
        points
          .filter(
            (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
          )
          .map((point) => {
            const marker = L.circleMarker([point.lat, point.lng], {
              radius: point.code === city ? 7 : 5,
              className: "isbf-alumni-map__city",
            });
            marker.bindTooltip(this.#label(point.name), {
              permanent: Boolean(region),
              direction: "top",
            });
            marker.on("click", () =>
              this.args.onSelect({
                country,
                region: point.region,
                city: point.code,
              }),
            );
            if (point.code === city) {
              this.#map.setView([point.lat, point.lng], 7);
            }
            return marker;
          }),
      ).addTo(this.#map);
      this.#refreshLabels();
    } catch {
      if (request === this.#request && !this.isDestroying) {
        this.error = true;
      }
    }
  }

  #refreshLabels() {
    if (!this.#map) {
      return;
    }
    const bounds = this.#map.getBounds();
    const show = (layer, enabled) => {
      const shape = layer.getBounds();
      const left = this.#map.latLngToContainerPoint(shape.getNorthWest());
      const right = this.#map.latLngToContainerPoint(shape.getSouthEast());
      if (
        enabled &&
        shape.intersects(bounds) &&
        Math.abs(right.x - left.x) > 60 &&
        Math.abs(right.y - left.y) > 24
      ) {
        layer.openTooltip();
      } else {
        layer.closeTooltip();
      }
    };
    this.#world?.eachLayer((layer) => show(layer, !this.#detail));
    this.#detail?.eachLayer((layer) => show(layer, this.#map.getZoom() >= 4));
    if (this.#cities) {
      const visible = Boolean(this.args.region) || this.#map.getZoom() >= 5;
      if (visible && !this.#map.hasLayer(this.#cities)) {
        this.#cities.addTo(this.#map);
      }
      if (!visible && this.#map.hasLayer(this.#cities)) {
        this.#cities.remove();
      }
    }
  }

  #label(name) {
    const label = document.createElement("span");
    label.textContent = name || "";
    return label;
  }

  async #loadLayer(url) {
    const path = sameOriginPath(url);
    if (!path) {
      throw new Error("Invalid map asset");
    }
    if (!this.#layers.has(path)) {
      this.#layers.set(
        path,
        ajax(path).catch((error) => {
          this.#layers.delete(path);
          throw error;
        }),
      );
    }
    return this.#layers.get(path);
  }

  <template>
    <div class="isbf-alumni-map">
      <DButton
        class="btn-flat isbf-alumni-map__reset"
        @action={{this.returnToChina}}
        @translatedLabel={{i18n (themePrefix "isbf_v2.alumni_return_china")}}
      />
      <div
        aria-label={{i18n (themePrefix "isbf_v2.alumni_map")}}
        class="isbf-alumni-map__canvas"
        {{didInsert this.insert}}
        {{didUpdate this.updateSelection @country @region @city}}
      ></div>
      {{#if this.loading}}<p role="status">{{i18n
            (themePrefix "isbf_v2.learning_loading")
          }}</p>{{/if}}
      {{#if this.error}}<p role="alert">{{i18n
            (themePrefix "isbf_v2.alumni_map_error")
          }}</p><DButton
          @action={{this.initialize}}
          @translatedLabel={{i18n (themePrefix "isbf_v2.explore_retry")}}
        />{{/if}}
      <small class="isbf-alumni-map__credit">Natural Earth · Leaflet</small>
    </div>
  </template>
}
