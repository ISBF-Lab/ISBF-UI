import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { themePrefix } from "virtual:theme";
import { ajax } from "discourse/lib/ajax";
import DButton from "discourse/ui-kit/d-button";
import DModal from "discourse/ui-kit/d-modal";
import { i18n } from "discourse-i18n";

export default class ISBFV2AccountLinkModal extends Component {
  @service dialog;

  @tracked errorMessage;
  @tracked isSubmitting = false;
  @tracked username = "";

  #closed = false;

  willDestroy() {
    super.willDestroy(...arguments);
    this.#closed = true;
  }

  get submitDisabled() {
    return this.isSubmitting || !this.username.trim();
  }

  @action
  close() {
    this.#closed = true;
    this.args.closeModal();
  }

  @action
  async submit(event) {
    event.preventDefault();
    if (this.#closed || this.submitDisabled) {
      return;
    }
    this.errorMessage = null;
    this.isSubmitting = true;
    try {
      await ajax("/isbf/account-switch/links", {
        type: "POST",
        data: { username: this.username.trim() },
      });
      if (this.#closed || this.isDestroying) {
        return;
      }
      this.close();
      this.dialog.alert(i18n(themePrefix("isbf_v2.account_link_sent")));
    } catch (error) {
      if (!this.#closed && !this.isDestroying) {
        this.errorMessage =
          error?.jqXHR?.responseJSON?.errors?.[0] ||
          error?.jqXHR?.responseJSON?.error ||
          i18n(themePrefix("isbf_v2.account_action_failed"));
      }
    } finally {
      if (!this.#closed && !this.isDestroying) {
        this.isSubmitting = false;
      }
    }
  }

  @action
  updateUsername(event) {
    this.username = event.target.value;
  }

  <template>
    <DModal
      class="isbf-v2-account-link-modal"
      @closeModal={{this.close}}
      @submitOnEnter={{false}}
      @title={{i18n (themePrefix "isbf_v2.link_account")}}
    >
      <:body>
        <form {{on "submit" this.submit}}>
          <label>
            {{i18n (themePrefix "isbf_v2.account_username")}}
            <input
              autocomplete="username"
              disabled={{this.isSubmitting}}
              placeholder={{i18n
                (themePrefix "isbf_v2.account_username_placeholder")
              }}
              required
              type="text"
              value={{this.username}}
              {{on "input" this.updateUsername}}
            />
          </label>
          {{#if this.errorMessage}}
            <p class="isbf-v2-account-link-modal__error" role="alert">
              {{this.errorMessage}}
            </p>
          {{/if}}
          <div class="isbf-v2-account-link-modal__actions">
            <DButton @action={{this.close}} @label="cancel" />
            <DButton
              class="btn-primary"
              @disabled={{this.submitDisabled}}
              @translatedLabel={{i18n
                (themePrefix "isbf_v2.send_link_request")
              }}
              @type="submit"
            />
          </div>
        </form>
      </:body>
    </DModal>
  </template>
}
