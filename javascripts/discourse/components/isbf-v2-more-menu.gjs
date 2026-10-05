import Component from "@glimmer/component";
import { fn } from "@ember/helper";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { settings, themePrefix } from "virtual:theme";
import DMenu from "discourse/float-kit/components/d-menu";
import DButton from "discourse/ui-kit/d-button";
import DDropdownMenu from "discourse/ui-kit/d-dropdown-menu";
import { i18n } from "discourse-i18n";
import { feedbackCategory, feedbackHref } from "../lib/feedback-category";
import ISBFV2JoinModal from "./isbf-v2-join-modal";

export default class ISBFV2MoreMenu extends Component {
  @service currentUser;
  @service dialog;
  @service modal;
  @service router;
  @service site;

  fallbackPlacements = ["top-start", "top-end"];

  @action
  async openSettings(menu) {
    await menu.close();
    this.router.transitionTo(
      this.currentUser
        ? `/u/${encodeURIComponent(this.currentUser.username)}/preferences`
        : "/login",
    );
  }

  @action
  async openFeedback(menu) {
    await menu.close();
    const href = feedbackHref(
      feedbackCategory(this.site, settings.feedback_category_id),
    );
    if (href) {
      this.router.transitionTo(href);
    } else {
      await this.dialog.alert(
        i18n(themePrefix("isbf_v2.feedback_unavailable")),
      );
    }
  }

  @action
  async openJoin(menu) {
    await menu.close();
    this.modal.show(ISBFV2JoinModal);
  }

  <template>
    <DMenu
      @ariaLabel={{i18n (themePrefix "isbf_v2.sidebar_more")}}
      @contentClass="isbf-v2-more-menu"
      @fallbackPlacements={{this.fallbackPlacements}}
      @icon="ellipsis"
      @identifier="isbf-v2-sidebar-more"
      @label={{i18n (themePrefix "isbf_v2.sidebar_more")}}
      @placement="top-start"
      @title={{i18n (themePrefix "isbf_v2.sidebar_more")}}
      @triggerClass="btn-flat isbf-v2-side__more"
    >
      <:content as |menu|>
        <DDropdownMenu as |dropdown|>
          <dropdown.item>
            <DButton
              @action={{fn this.openSettings menu}}
              @class="btn-flat isbf-v2-more-menu__item"
              @icon="gear"
              @translatedLabel={{i18n (themePrefix "isbf_v2.sidebar_settings")}}
            />
          </dropdown.item>
          <dropdown.item>
            <DButton
              @action={{fn this.openFeedback menu}}
              @class="btn-flat isbf-v2-more-menu__item"
              @icon="comment"
              @translatedLabel={{i18n (themePrefix "isbf_v2.feedback")}}
            />
          </dropdown.item>
          <dropdown.item>
            <DButton
              @action={{fn this.openJoin menu}}
              @class="btn-flat isbf-v2-more-menu__item"
              @icon="user-group"
              @translatedLabel={{i18n (themePrefix "isbf_v2.join_us")}}
            />
          </dropdown.item>
        </DDropdownMenu>
      </:content>
    </DMenu>
  </template>
}
