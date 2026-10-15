import Component from "@glimmer/component";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { themePrefix } from "virtual:theme";
import DButton from "discourse/ui-kit/d-button";
import { PERSONAL_CALENDAR_FEED } from "../lib/calendar-subscription";
import ISBFCalendarSubscription from "./isbf-calendar-subscription";

export default class ISBFCalendarSubscribe extends Component {
  @service currentUser;
  @service modal;
  @service site;

  get available() {
    return (
      this.currentUser &&
      this.site.isbf_calendar?.subscription_feed === PERSONAL_CALENDAR_FEED
    );
  }

  @action
  open() {
    if (this.available) {
      this.modal.show(ISBFCalendarSubscription, {
        model: { userId: this.currentUser.id },
      });
    }
  }

  <template>
    {{#if this.available}}
      <DButton
        class="btn-default isbf-calendar-subscribe"
        @action={{this.open}}
        @icon="calendar-days"
        @label={{themePrefix "isbf_v2.calendar_subscribe_apple"}}
      />
    {{/if}}
  </template>
}
