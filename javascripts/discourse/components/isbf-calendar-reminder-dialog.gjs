import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { themePrefix } from "virtual:theme";
import { ajax } from "discourse/lib/ajax";
import DButton from "discourse/ui-kit/d-button";
import DModal from "discourse/ui-kit/d-modal";
import { i18n } from "discourse-i18n";
import { calendarEntryTime } from "../lib/calendar-entry";
import { compatibleReminder } from "../lib/calendar-reminder";
import {
  OFFICIAL_CALENDAR_FIELD,
  officialTimeLabel,
} from "../lib/official-calendar";
import ISBFCalendarReminderPicker from "./isbf-calendar-reminder-picker";

export default class ISBFCalendarReminderDialog extends Component {
  @service site;

  @tracked item;
  @tracked mode = "none";
  @tracked saving = false;
  @tracked error = false;
  @tracked changed = false;

  constructor() {
    super(...arguments);
    this.item = this.args.model.item;
    this.mode = this.args.model.entry?.reminder_mode || "none";
  }

  get editing() {
    return Boolean(this.args.model.entry);
  }

  get unavailable() {
    return this.item.cancelled || this.item.source_unavailable;
  }

  get remindersUnavailable() {
    return !this.site?.isbf_calendar?.reminders?.enabled || this.unavailable;
  }

  get timeLabel() {
    return this.editing
      ? calendarEntryTime(this.item)
      : officialTimeLabel(this.item);
  }

  get saveDisabled() {
    return (
      this.saving ||
      (!this.editing && this.remindersUnavailable) ||
      (this.editing && this.remindersUnavailable && this.mode !== "none")
    );
  }

  @action
  beforeClose() {
    return !this.saving;
  }

  @action
  cancel() {
    if (!this.saving) {
      this.args.closeModal();
    }
  }

  @action
  setReminder(mode) {
    this.mode = mode;
  }

  @action
  async save() {
    if (this.saveDisabled) {
      return;
    }
    const mode = this.unavailable
      ? "none"
      : compatibleReminder(this.mode, this.item.all_day);
    this.saving = true;
    this.error = false;
    this.changed = false;
    try {
      const fields = {
        reminder_mode: mode,
        reminder_timezone: "Asia/Shanghai",
      };
      const { entry } = await ajax(
        this.editing
          ? `/isbf/api/entries/${this.item.id}.json`
          : `/isbf/api/official-items/${this.item.id}/add.json`,
        {
          type: this.editing ? "PATCH" : "POST",
          data: this.editing
            ? { entry: fields }
            : { revision: this.item.revision, ...fields },
        }
      );
      if (!this.isDestroying) {
        this.args.model.onChanged(entry);
        this.args.closeModal();
      }
    } catch (error) {
      if (!this.isDestroying) {
        this.error = true;
        if (
          !this.editing &&
          error.jqXHR?.status === 409 &&
          this.args.model.postId
        ) {
          try {
            const post = await ajax(`/posts/${this.args.model.postId}.json`);
            if (!this.isDestroying) {
              this.args.model.onRefreshed?.(post);
              const item = post[OFFICIAL_CALENDAR_FIELD]?.find(
                ({ id }) => id === this.item.id
              );
              this.item = item || { ...this.item, source_unavailable: true };
              this.mode = this.unavailable
                ? "none"
                : compatibleReminder(this.mode, this.item.all_day);
              this.changed = true;
              this.error = false;
            }
          } catch {
            this.error = true;
          }
        }
      }
    } finally {
      if (!this.isDestroying) {
        this.saving = false;
      }
    }
  }

  <template>
    <DModal
      class="isbf-calendar-reminder-dialog"
      @beforeClose={{this.beforeClose}}
      @closeModal={{this.cancel}}
      @title={{i18n
        (themePrefix
          (if
            this.editing "isbf_v2.reminder_settings" "isbf_v2.reminder_confirm"
          )
        )
      }}
    >
      <:body>
        <h3>{{this.item.title}}</h3><p>{{this.timeLabel}}</p>
        <ISBFCalendarReminderPicker
          @allDay={{this.item.all_day}}
          @disabled={{this.saving}}
          @mode={{this.mode}}
          @official={{true}}
          @onChange={{this.setReminder}}
          @startsAt={{this.item.starts_at}}
          @timezone="Asia/Shanghai"
          @unavailable={{this.remindersUnavailable}}
        />
        {{#if this.changed}}<p role="status">{{i18n
              (themePrefix "isbf_v2.reminder_source_changed")
            }}</p>{{/if}}
        {{#if this.error}}<p role="alert">{{i18n
              (themePrefix "isbf_v2.calendar_save_error")
            }}</p>{{/if}}
      </:body>
      <:footer>
        <DButton
          @action={{this.cancel}}
          @disabled={{this.saving}}
          @label={{themePrefix "isbf_v2.calendar_cancel"}}
        />
        <DButton
          class="btn-primary"
          @action={{this.save}}
          @disabled={{this.saveDisabled}}
          @isLoading={{this.saving}}
          @label={{themePrefix
            (if this.editing "isbf_v2.calendar_save" "isbf_v2.reminder_add")
          }}
        />
      </:footer>
    </DModal>
  </template>
}
