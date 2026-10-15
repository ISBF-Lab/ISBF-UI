import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { themePrefix } from "virtual:theme";
import { ajax } from "discourse/lib/ajax";
import getURL from "discourse/lib/get-url";
import { clipboardCopy } from "discourse/lib/utilities";
import DButton from "discourse/ui-kit/d-button";
import DModal from "discourse/ui-kit/d-modal";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";
import {
  appleCalendarURL,
  PERSONAL_CALENDAR_FEED,
} from "../lib/calendar-subscription";

export default class ISBFCalendarSubscription extends Component {
  @service currentUser;
  @service dialog;

  @tracked copied = false;
  @tracked error = false;
  @tracked hasSubscription = false;
  @tracked loading = true;
  @tracked ready = false;
  @tracked unavailable = false;
  @tracked url = null;

  #generation = 0;

  constructor() {
    super(...arguments);
    void this.load();
  }

  willDestroy() {
    super.willDestroy(...arguments);
    this.#generation++;
    this.url = null;
  }

  get webcalURL() {
    if (!this.#isCurrent()) {
      return null;
    }
    return appleCalendarURL(
      this.url,
      window.location.origin,
      getURL("/isbf/api/calendar.ics")
    );
  }

  @action
  async load() {
    const generation = ++this.#generation;
    this.loading = true;
    this.error = false;
    try {
      const status = await ajax("/calendar-subscriptions.json");
      if (this.#isCurrent(generation)) {
        this.hasSubscription = status.has_subscription;
        this.unavailable = !status.feeds?.includes(PERSONAL_CALENDAR_FEED);
        this.ready = true;
      }
    } catch {
      if (this.#isCurrent(generation)) {
        this.error = true;
      }
    } finally {
      if (this.#isCurrent(generation)) {
        this.loading = false;
      }
    }
  }

  @action
  async generate() {
    if (this.loading || !this.ready || this.unavailable || !this.#isCurrent()) {
      return;
    }
    this.loading = true;
    this.error = false;
    const generation = ++this.#generation;
    try {
      // Core regenerates one shared key for every calendar feed.
      if (
        this.hasSubscription &&
        !(await this.dialog.confirm({
          message: i18n(themePrefix("isbf_v2.calendar_subscription_replace")),
        }))
      ) {
        return;
      }
      if (!this.#isCurrent(generation)) {
        return;
      }
      const result = await ajax("/calendar-subscriptions.json", {
        type: "POST",
      });
      if (this.#isCurrent(generation)) {
        this.url = result.urls?.[PERSONAL_CALENDAR_FEED] ?? null;
        this.hasSubscription = true;
        this.copied = false;
        this.error = !this.webcalURL;
      }
    } catch {
      if (this.#isCurrent(generation)) {
        this.error = true;
      }
    } finally {
      if (this.#isCurrent(generation)) {
        this.loading = false;
      }
    }
  }

  @action
  async copy() {
    if (!this.webcalURL || !this.#isCurrent()) {
      return;
    }
    const generation = this.#generation;
    try {
      await clipboardCopy(this.url);
      if (this.#isCurrent(generation)) {
        this.copied = true;
      }
    } catch {
      if (this.#isCurrent(generation)) {
        this.error = true;
      }
    }
  }

  @action
  async revoke() {
    if (this.loading || !this.hasSubscription || !this.#isCurrent()) {
      return;
    }
    this.loading = true;
    this.error = false;
    const generation = ++this.#generation;
    try {
      if (
        !(await this.dialog.confirm({
          message: i18n(
            themePrefix("isbf_v2.calendar_subscription_revoke_confirm")
          ),
        })) ||
        !this.#isCurrent(generation)
      ) {
        return;
      }
      await ajax("/calendar-subscriptions.json", { type: "DELETE" });
      if (this.#isCurrent(generation)) {
        this.url = null;
        this.hasSubscription = false;
        this.copied = false;
      }
    } catch {
      if (this.#isCurrent(generation)) {
        this.error = true;
      }
    } finally {
      if (this.#isCurrent(generation)) {
        this.loading = false;
      }
    }
  }

  #isCurrent(generation = this.#generation) {
    return (
      !this.isDestroying &&
      generation === this.#generation &&
      this.currentUser?.id === this.args.model.userId
    );
  }

  <template>
    <DModal
      class="isbf-calendar-subscription"
      @closeModal={{@closeModal}}
      @title={{i18n (themePrefix "isbf_v2.calendar_subscribe_apple")}}
    >
      <:body>
        <p>{{i18n
            (themePrefix "isbf_v2.calendar_subscription_description")
          }}</p>
        <p class="isbf-calendar-subscription__note">{{i18n
            (themePrefix "isbf_v2.calendar_subscription_refresh")
          }}</p>
        {{#if this.loading}}
          <p aria-live="polite" role="status">{{i18n
              (themePrefix "isbf_v2.calendar_subscription_loading")
            }}</p>
        {{/if}}
        {{#if this.unavailable}}
          <p role="status">{{i18n
              (themePrefix "isbf_v2.calendar_subscription_unavailable")
            }}</p>
        {{else if this.ready}}
          {{#if this.webcalURL}}
            <p>{{i18n
                (themePrefix "isbf_v2.calendar_subscription_private")
              }}</p>
            <div class="isbf-calendar-subscription__actions">
              <a
                class="btn btn-primary"
                href={{this.webcalURL}}
                rel="noreferrer"
              >{{dIcon "calendar-days"}}{{i18n
                  (themePrefix "isbf_v2.calendar_subscribe_apple")
                }}</a>
              <DButton
                @action={{this.copy}}
                @disabled={{this.loading}}
                @icon={{if this.copied "check" "copy"}}
                @label={{themePrefix
                  (if
                    this.copied
                    "isbf_v2.calendar_subscription_copied"
                    "isbf_v2.calendar_subscription_copy"
                  )
                }}
              />
            </div>
          {{else}}
            {{#if this.hasSubscription}}
              <p>{{i18n
                  (themePrefix "isbf_v2.calendar_subscription_existing")
                }}</p>
            {{/if}}
            <DButton
              class="btn-primary"
              @action={{this.generate}}
              @disabled={{this.loading}}
              @icon="calendar-days"
              @label={{themePrefix
                (if
                  this.hasSubscription
                  "isbf_v2.calendar_subscription_regenerate"
                  "isbf_v2.calendar_subscription_generate"
                )
              }}
            />
          {{/if}}
          {{#if this.hasSubscription}}
            <DButton
              class="btn-flat isbf-calendar-subscription__revoke"
              @action={{this.revoke}}
              @disabled={{this.loading}}
              @label={{themePrefix "isbf_v2.calendar_subscription_revoke"}}
            />
          {{/if}}
        {{/if}}
        {{#if this.error}}
          <p class="isbf-calendar-subscription__error" role="alert">{{i18n
              (themePrefix "isbf_v2.calendar_subscription_error")
            }}</p>
          {{#unless this.ready}}
            <DButton
              @action={{this.load}}
              @disabled={{this.loading}}
              @label={{themePrefix "isbf_v2.official_retry"}}
            />
          {{/unless}}
        {{/if}}
      </:body>
    </DModal>
  </template>
}
