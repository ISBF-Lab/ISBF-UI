import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import { themePrefix } from "virtual:theme";
import { ajax } from "discourse/lib/ajax";
import DButton from "discourse/ui-kit/d-button";
import { i18n } from "discourse-i18n";
import ISBFLearningGradePicker from "./isbf-learning-grade-picker";

export default class ISBFLearningCourseDialog extends Component {
  @tracked error = false;
  @tracked grade = this.args.grade;
  @tracked name = "";
  @tracked saving = false;

  get saveDisabled() {
    return this.saving || !this.name.trim();
  }

  @action
  changeGrade(id) {
    this.grade = id;
  }

  @action
  changeName(event) {
    this.name = event.target.value;
  }

  @action
  focusName(element) {
    element.focus();
  }

  @action
  handleKeydown(event) {
    if (event.key === "Escape" && !this.saving) {
      event.stopPropagation();
      this.args.onClose();
    }
  }

  @action
  async save(event) {
    event.preventDefault();
    if (this.saveDisabled) {
      return;
    }
    this.error = false;
    this.saving = true;
    try {
      await ajax("/isbf/learning/courses", {
        type: "POST",
        data: { name: this.name.trim(), grade: this.grade },
      });
      this.args.onCreated(this.grade);
    } catch {
      if (!this.isDestroying && !this.isDestroyed) {
        this.error = true;
      }
    } finally {
      if (!this.isDestroying && !this.isDestroyed) {
        this.saving = false;
      }
    }
  }

  <template>
    <section
      aria-label={{i18n (themePrefix "isbf_v2.learning_add_course")}}
      class="isbf-learning-course-dialog"
      role="dialog"
      {{on "keydown" this.handleKeydown}}
    >
      <h2>{{i18n (themePrefix "isbf_v2.learning_add_course")}}</h2>
      <form {{on "submit" this.save}}>
        <label>
          <span>{{i18n (themePrefix "isbf_v2.learning_course_name")}}</span>
          <input
            maxlength="80"
            required
            type="text"
            value={{this.name}}
            {{on "input" this.changeName}}
            {{didInsert this.focusName}}
          />
        </label>
        <ISBFLearningGradePicker
          @grades={{@grades}}
          @onChange={{this.changeGrade}}
          @value={{this.grade}}
        />
        {{#if this.error}}<p role="alert">{{i18n
              (themePrefix "isbf_v2.learning_course_save_error")
            }}</p>{{/if}}
        <div class="isbf-learning-course-dialog__actions">
          <DButton
            @action={{@onClose}}
            @disabled={{this.saving}}
            @translatedLabel={{i18n (themePrefix "isbf_v2.compose_cancel")}}
          />
          <DButton
            class="btn-primary"
            @disabled={{this.saveDisabled}}
            @translatedLabel={{i18n (themePrefix "isbf_v2.learning_save")}}
            @type="submit"
          />
        </div>
      </form>
    </section>
  </template>
}
