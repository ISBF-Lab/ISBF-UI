import Component from "@glimmer/component";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { tracked } from "@glimmer/tracking";
import { themePrefix } from "virtual:theme";
import dAvatar from "discourse/ui-kit/helpers/d-avatar";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";

import { isQuickPost } from "../lib/quick-post-scope";

export default class ISBFV2ComposerOptions extends Component {
  @service currentUser;

  @tracked optionsExpanded = false;

  get isQuickPost() {
    return isQuickPost(this.args.outletArgs?.model);
  }

  get optionsVisible() {
    return this.optionsExpanded || Boolean(this.args.outletArgs?.model?.requiredCategoryMissing);
  }

  @action
  toggleOptions() {
    this.optionsExpanded = !this.optionsVisible;
  }

  <template>
    {{#if this.isQuickPost}}
      <div class="isbf-v2-composer-options">
        <div aria-hidden="true" class="isbf-v2-composer-options__avatar">
          {{dAvatar this.currentUser imageSize="large"}}
        </div>
        <button
          aria-expanded={{this.optionsVisible}}
          class="isbf-v2-composer-options__toggle"
          type="button"
          {{on "click" this.toggleOptions}}
        >
          {{i18n (themePrefix "isbf_v2.compose_options")}}
          {{dIcon "chevron-right"}}
        </button>
      </div>
    {{/if}}
  </template>
}
