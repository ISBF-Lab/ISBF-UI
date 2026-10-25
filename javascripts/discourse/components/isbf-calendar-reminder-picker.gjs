import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { fn } from "@ember/helper";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import { themePrefix } from "virtual:theme";
import { eq } from "discourse/truth-helpers";
import DButton from "discourse/ui-kit/d-button";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import dUniqueId from "discourse/ui-kit/helpers/d-unique-id";
import { i18n } from "discourse-i18n";
import {
  compatibleReminder,
  reminderModes,
  reminderTime,
} from "../lib/calendar-reminder";

export default class ISBFCalendarReminderPicker extends Component {
  @tracked expanded = false;
  @tracked pending = "none";

  groupName = dUniqueId();

  get mode() {
    return compatibleReminder(this.args.mode, this.args.allDay);
  }

  get label() {
    return i18n(themePrefix(`isbf_v2.reminder_${this.mode}`));
  }

  get past() {
    const at = reminderTime(
      this.mode,
      this.args.startsAt,
      this.args.allDay,
      this.args.timezone,
      this.args.official
    );
    return at !== null && (!Number.isFinite(at) || at <= Date.now());
  }

  get choices() {
    return reminderModes(this.args.allDay).map((mode) => ({
      mode,
      label: i18n(themePrefix(`isbf_v2.reminder_${mode}`)),
      disabled: Boolean(
        this.args.disabled || (this.args.unavailable && mode !== "none")
      ),
    }));
  }

  @action
  open() {
    this.pending = this.mode;
    this.expanded = true;
  }

  @action
  choose(mode) {
    this.pending = mode;
  }

  @action
  cancel() {
    this.expanded = false;
  }

  @action
  done() {
    if (this.args.disabled) {
      return;
    }
    const mode = compatibleReminder(this.pending, this.args.allDay);
    this.args.onChange(mode);
    this.expanded = false;
  }

  <template>
    <div class="isbf-calendar-reminder">
      <button
        aria-expanded={{this.expanded}}
        class="isbf-calendar-reminder__row"
        disabled={{@disabled}}
        type="button"
        {{on "click" this.open}}
      >
        <span>{{dIcon "bell"}}{{i18n
            (themePrefix "isbf_v2.reminder_label")
          }}</span><span>{{this.label}}{{dIcon "chevron-right"}}</span>
      </button>
      {{#if this.expanded}}
        <fieldset class="isbf-calendar-reminder__choices">
          <legend>{{i18n (themePrefix "isbf_v2.reminder_label")}}</legend>
          {{#each this.choices as |choice|}}
            <label><input
                checked={{eq this.pending choice.mode}}
                disabled={{choice.disabled}}
                name={{this.groupName}}
                type="radio"
                value={{choice.mode}}
                {{on "change" (fn this.choose choice.mode)}}
              />{{choice.label}}</label>
          {{/each}}
          <div class="isbf-calendar-reminder__actions">
            <DButton
              @action={{this.cancel}}
              @disabled={{@disabled}}
              @label={{themePrefix "isbf_v2.calendar_cancel"}}
            />
            <DButton
              class="btn-primary"
              @action={{this.done}}
              @disabled={{@disabled}}
              @label={{themePrefix "isbf_v2.reminder_done"}}
            />
          </div>
        </fieldset>
      {{/if}}
      {{#if this.past}}<p role="status">{{i18n
            (themePrefix "isbf_v2.reminder_past")
          }}</p>{{/if}}
    </div>
  </template>
}
