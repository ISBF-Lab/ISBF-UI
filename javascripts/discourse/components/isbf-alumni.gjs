import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { fn } from "@ember/helper";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import didUpdate from "@ember/render-modifiers/modifiers/did-update";
import { service } from "@ember/service";
import { themePrefix } from "virtual:theme";
import { ajax } from "discourse/lib/ajax";
import { eq, or } from "discourse/truth-helpers";
import DButton from "discourse/ui-kit/d-button";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";
import { alumniConfig, alumniLocation, alumniRegions } from "../lib/alumni";
import ISBFAlumniLabel from "./isbf-alumni-label";
import ISBFAlumniMap from "./isbf-alumni-map";
import ISBFAlumniProfile from "./isbf-alumni-profile";

export default class ISBFAlumni extends Component {
  @service appEvents;
  @service currentUser;
  @service site;

  @tracked country = "CN";
  @tracked region = "";
  @tracked users = [];
  @tracked loading = false;
  @tracked error = false;
  @tracked hasMore = false;
  @tracked editing = false;
  @tracked geography = null;
  @tracked geographyError = false;
  @tracked distribution = null;
  @tracked distributionError = false;
  @tracked distributionLoading = false;

  #page = 0;
  #request = 0;
  #trigger;
  #distributionRequest = 0;
  #distributionOwner;
  #distributionCache = new Map();
  #distributionInFlight = new Map();

  constructor() {
    super(...arguments);
    if (this.config && this.currentUser) {
      this.#distributionOwner = this.currentUser.id;
      this.loadGeography();
      this.loadDirectory();
      this.loadDistribution();
    } else if (this.config) {
      this.login();
    }
  }

  willDestroy() {
    super.willDestroy(...arguments);
    this.#request++;
    this.#distributionRequest++;
    this.#distributionCache.clear();
    this.#distributionInFlight.clear();
    this.distribution = null;
  }

  get config() {
    return alumniConfig(this.site);
  }

  get mapConfig() {
    return this.geography
      ? { ...this.config, countries: this.geography.countries }
      : null;
  }

  get countries() {
    return this.mapConfig?.countries || this.config?.countries || [];
  }

  get regions() {
    return alumniRegions(this.mapConfig, this.country);
  }

  get directoryUsers() {
    return this.users.map((user) => ({
      ...user,
      location: alumniLocation(user),
      href: `/u/${encodeURIComponent(user.username)}`,
    }));
  }

  @action
  async loadGeography() {
    this.geographyError = false;
    try {
      const response = await ajax(this.config.geography_url);
      if (!this.isDestroying) {
        this.geography = response;
      }
    } catch {
      if (!this.isDestroying) {
        this.geographyError = true;
      }
    }
  }

  @action
  login() {
    this.appEvents.trigger("show-login");
  }

  @action
  countryChanged(event) {
    this.selectLocation({ country: event.target.value });
  }

  @action
  regionChanged(event) {
    this.selectLocation({ country: this.country, region: event.target.value });
  }

  @action
  selectLocation({ country = "", region = "" }) {
    this.country = country;
    this.region = country === "CN" ? region : "";
    this.loadDirectory();
    this.loadDistribution();
  }

  @action
  async loadDirectory(append = false) {
    if (!this.currentUser || !this.config || (append && this.loading)) {
      return;
    }
    const owner = this.currentUser.id;
    const request = ++this.#request;
    const page = append ? this.#page + 1 : 1;
    this.loading = true;
    this.error = false;
    if (!append) {
      this.users = [];
      this.hasMore = false;
    }
    try {
      const response = await ajax("/isbf/alumni/directory", {
        data: {
          country: this.country,
          region: this.region,
          page,
        },
      });
      if (request !== this.#request || owner !== this.currentUser?.id) {
        return;
      }
      this.users = append
        ? [...this.users, ...response.users]
        : response.users || [];
      this.hasMore = response.has_more === true;
      this.#page = page;
    } catch {
      if (request === this.#request && owner === this.currentUser?.id) {
        this.error = true;
      }
    } finally {
      if (request === this.#request && owner === this.currentUser?.id) {
        this.loading = false;
      }
    }
  }

  @action
  accountChanged() {
    if (this.#distributionOwner === this.currentUser?.id) {
      return;
    }
    this.#distributionOwner = this.currentUser?.id;
    this.#request++;
    this.#distributionRequest++;
    this.#distributionCache.clear();
    this.#distributionInFlight.clear();
    this.distribution = null;
    this.distributionError = false;
    this.distributionLoading = false;
    this.loading = false;
    this.error = false;
    this.editing = false;
    this.#trigger = null;
    this.users = [];
    this.hasMore = false;
    if (this.currentUser && this.config) {
      this.loadDirectory();
      this.loadDistribution();
    }
  }

  @action
  async loadDistribution() {
    if (!this.currentUser || !this.config || this.isDestroying) {
      return;
    }
    const owner = this.currentUser.id;
    const country = this.country;
    const region = this.region;
    const key = `${country}:${region}`;
    const request = ++this.#distributionRequest;
    this.distribution = this.#distributionCache.get(key) || null;
    this.distributionError = false;
    this.distributionLoading = true;
    let pending = this.#distributionInFlight.get(key);
    if (!pending) {
      pending = ajax("/isbf/alumni/distribution", {
        data: { country, region },
      });
      this.#distributionInFlight.set(key, pending);
    }
    try {
      const response = await pending;
      if (
        request !== this.#distributionRequest ||
        owner !== this.currentUser?.id ||
        this.isDestroying
      ) {
        return;
      }
      if (
        response?.country !== country ||
        response?.region !== region ||
        ![response.countries, response.regions, response.cities].every(
          Array.isArray
        )
      ) {
        throw new Error("Invalid alumni distribution response");
      }
      if (
        this.#distributionCache.size >= 40 &&
        !this.#distributionCache.has(key)
      ) {
        this.#distributionCache.delete(
          this.#distributionCache.keys().next().value
        );
      }
      this.#distributionCache.set(key, response);
      this.distribution = response;
    } catch {
      if (
        request === this.#distributionRequest &&
        owner === this.currentUser?.id &&
        !this.isDestroying
      ) {
        this.distributionError = true;
      }
    } finally {
      if (this.#distributionInFlight.get(key) === pending) {
        this.#distributionInFlight.delete(key);
      }
      if (
        request === this.#distributionRequest &&
        owner === this.currentUser?.id &&
        !this.isDestroying
      ) {
        this.distributionLoading = false;
      }
    }
  }

  @action
  retry() {
    this.loadDirectory(this.users.length > 0);
  }

  @action
  openProfile() {
    this.#trigger = document.activeElement;
    this.editing = true;
  }

  @action
  closeProfile() {
    this.editing = false;
    this.#trigger?.focus();
  }

  @action
  profileSaved() {
    this.closeProfile();
    this.#distributionCache.clear();
    this.#distributionInFlight.clear();
    this.loadDirectory();
    this.loadDistribution();
  }

  <template>
    <main
      class="isbf-alumni"
      {{didUpdate this.accountChanged this.currentUser.id}}
    >
      <header class="isbf-alumni__header">
        <a class="isbf-alumni__back" href="/isbf/workbench">
          {{dIcon "arrow-left"}}<h1>{{i18n
              (themePrefix "isbf_v2.workbench_alumni")
            }}</h1>
        </a>
        {{#if this.currentUser.isbf_alumni_member}}
          {{#if this.mapConfig}}
            <DButton
              @action={{this.openProfile}}
              @translatedLabel={{i18n
                (themePrefix "isbf_v2.alumni_my_profile")
              }}
            />
          {{/if}}
        {{/if}}
      </header>
      {{#if this.currentUser}}
        {{#if this.config}}
          {{#if this.editing}}<ISBFAlumniProfile
              @config={{this.mapConfig}}
              @onClose={{this.closeProfile}}
              @onSaved={{this.profileSaved}}
            />{{/if}}
          <div class="isbf-alumni__filters">
            <label>{{i18n (themePrefix "isbf_v2.alumni_country")}}
              <select
                value={{this.country}}
                {{on "change" this.countryChanged}}
              >
                <option value="">{{i18n
                    (themePrefix "isbf_v2.alumni_all")
                  }}</option>
                {{#each this.countries as |country|}}<option
                    selected={{eq this.country country.code}}
                    value={{country.code}}
                  >{{country.name}}</option>{{/each}}
              </select>
            </label>
            {{#if this.regions.length}}<label>{{i18n
                  (themePrefix "isbf_v2.alumni_region")
                }}
                <select
                  value={{this.region}}
                  {{on "change" this.regionChanged}}
                ><option value="">{{i18n
                      (themePrefix "isbf_v2.alumni_all")
                    }}</option>
                  {{#each this.regions as |region|}}<option
                      selected={{eq this.region region.code}}
                      value={{region.code}}
                    >{{region.name}}</option>{{/each}}
                </select>
              </label>{{/if}}
          </div>
          {{#if this.mapConfig}}<ISBFAlumniMap
              @config={{this.mapConfig}}
              @country={{this.country}}
              @distribution={{this.distribution}}
              @distributionError={{this.distributionError}}
              @distributionLoading={{this.distributionLoading}}
              @onRetryDistribution={{this.loadDistribution}}
              @onSelect={{this.selectLocation}}
              @region={{this.region}}
            />{{else if this.geographyError}}<p
              class="isbf-alumni__notice"
              role="alert"
            >{{i18n (themePrefix "isbf_v2.alumni_map_error")}}</p><DButton
              @action={{this.loadGeography}}
              @translatedLabel={{i18n (themePrefix "isbf_v2.explore_retry")}}
            />{{/if}}
          <section
            aria-busy={{this.loading}}
            aria-label={{i18n (themePrefix "isbf_v2.alumni_directory")}}
            class="isbf-alumni__directory"
          >
            {{#each this.directoryUsers key="id" as |user|}}
              <article class="isbf-alumni__person">
                <a href={{user.href}}>{{user.display_name}}<ISBFAlumniLabel
                    @user={{user}}
                  /></a>
                {{#if (or user.location user.industry)}}
                  <div class="isbf-alumni__meta">
                    {{#if user.location}}<span>{{user.location}}</span>{{/if}}
                    {{#if user.industry}}<span>{{user.industry}}</span>{{/if}}
                  </div>
                {{/if}}
                {{#if user.bio}}<p
                    class="isbf-alumni__bio"
                  >{{user.bio}}</p>{{/if}}
              </article>
            {{/each}}
            {{#if this.loading}}<p role="status">{{i18n
                  (themePrefix "isbf_v2.learning_loading")
                }}</p>
            {{else if this.error}}<p role="alert">{{i18n
                  (themePrefix "isbf_v2.alumni_load_error")
                }}</p><DButton
                @action={{this.retry}}
                @translatedLabel={{i18n (themePrefix "isbf_v2.explore_retry")}}
              />
            {{else if this.hasMore}}<DButton
                @action={{fn this.loadDirectory true}}
                @translatedLabel={{i18n (themePrefix "isbf_v2.load_more")}}
              />
            {{else if (eq this.users.length 0)}}<p>{{i18n
                  (themePrefix "isbf_v2.alumni_empty")
                }}</p>{{/if}}
          </section>
        {{else}}<p class="isbf-alumni__notice">{{i18n
              (themePrefix "isbf_v2.alumni_unavailable")
            }}</p>{{/if}}
      {{else}}<div class="isbf-alumni__notice"><p>{{i18n
              (themePrefix "isbf_v2.alumni_login")
            }}</p><DButton
            @action={{this.login}}
            @translatedLabel={{i18n "log_in"}}
          /></div>{{/if}}
    </main>
  </template>
}
