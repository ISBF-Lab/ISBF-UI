import Component from "@glimmer/component";
import { action } from "@ember/object";
import { getOwner } from "@ember/owner";
import { service } from "@ember/service";
import TopicFooterButtons from "discourse/components/topic-footer-buttons";
import TopicMap from "discourse/components/topic-map";
import routeAction from "discourse/helpers/route-action";
import DButton from "discourse/ui-kit/d-button";
import DModal from "discourse/ui-kit/d-modal";
import { i18n } from "discourse-i18n";
import { themePrefix } from "virtual:theme";

export default class ISBFTopicInfo extends Component {
  @service currentUser;

  get controller() {
    return getOwner(this).lookup("controller:topic");
  }

  @action
  async editTitle() {
    this.args.closeModal();
    await this.controller.editTopic();
    document.querySelector("#topic-title")?.scrollIntoView({ block: "start" });
  }

  <template>
    <DModal
      class="isbf-topic-info"
      @closeModal={{@closeModal}}
      @title={{themePrefix "isbf_v2.topic_info"}}
    >
      <:body>
        <h2>{{@model.title}}</h2>
        <p>{{@model.category.name}}</p>
        {{#if @model.details.can_edit}}
          <DButton
            @action={{this.editTitle}}
            @icon="pencil"
            @translatedLabel={{i18n (themePrefix "isbf_v2.topic_edit_title")}}
          />
        {{/if}}
        <div class="topic-map">
          <TopicMap
            @cancelFilter={{this.controller.cancelFilter}}
            @model={{@model}}
            @postStream={{@model.postStream}}
            @showPMMap={{false}}
            @topicDetails={{@model.details}}
          />
        </div>
        {{#if this.currentUser}}
          <TopicFooterButtons
            @convertToPrivateMessage={{this.controller.convertToPrivateMessage}}
            @convertToPublicTopic={{this.controller.convertToPublicTopic}}
            @deferTopic={{this.controller.deferTopic}}
            @editFirstPost={{this.controller.editFirstPost}}
            @replyToPost={{this.controller.replyToPost}}
            @toggleBookmark={{this.controller.toggleBookmark}}
            @deleteTopic={{this.controller.deleteTopic}}
            @recoverTopic={{this.controller.recoverTopic}}
            @resetBumpDate={{this.controller.resetBumpDate}}
            @showChangeTimestamp={{routeAction "showChangeTimestamp"}}
            @showCreate={{false}}
            @showFlagTopic={{routeAction "showFlagTopic"}}
            @showFeatureTopic={{routeAction "showFeatureTopic"}}
            @showTopicSlowModeUpdate={{routeAction "showTopicSlowModeUpdate"}}
            @showTopicTimerModal={{routeAction "showTopicTimerModal"}}
            @toggleArchived={{this.controller.toggleArchived}}
            @toggleClosed={{this.controller.toggleClosed}}
            @toggleFeaturedOnProfile={{this.controller.toggleFeaturedOnProfile}}
            @toggleMultiSelect={{this.controller.toggleMultiSelect}}
            @toggleVisibility={{this.controller.toggleVisibility}}
            @topic={{@model}}
          />
        {{/if}}
      </:body>
    </DModal>
  </template>
}
