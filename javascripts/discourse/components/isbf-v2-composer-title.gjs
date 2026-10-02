import Component from "@glimmer/component";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import EmberObject, { action, computed } from "@ember/object";
import { alias } from "@ember/object/computed";
import ComposerTitle from "discourse/components/composer-title";
import { isQuickPost } from "../lib/quick-post-scope";
import {
  optionalTopicTitle,
  setOptionalTopicTitle,
} from "../lib/optional-topic-title";

class OptionalTitleModel extends EmberObject {
  @alias("content.canEditTopicFeaturedLink") canEditTopicFeaturedLink;
  @alias("content.loading") loading;
  @alias("content.disableTitleInput") disableTitleInput;
  @alias("content.titleLength") titleLength;
  @alias("content.missingTitleCharacters") missingTitleCharacters;
  @alias("content.minimumTitleLength") minimumTitleLength;
  @alias("content.categoryTitlePlaceholder") categoryTitlePlaceholder;
  @alias("content.titlePlaceholder") titlePlaceholder;
  @alias("content.reply") reply;
  @alias("content.replyLength") replyLength;
  @alias("content.category") category;
  @alias("content.featuredLink") featuredLink;
  @alias("content.action") action;
  @alias("content.post") post;
  @alias("content.topic") topic;
  @alias("content.privateMessage") privateMessage;
  @alias("content.siteSettings") siteSettings;


  @computed("content.title", "content.isbf_optional_title")
  get title() {
    return (
      this.content.isbf_optional_title ?? optionalTopicTitle(this.content.title)
    );
  }

  set title(value) {
    setOptionalTopicTitle(this.content, value);
    return value;
  }
  appendText(...args) {
    return this.content.appendText(...args);
  }
}

export default class ISBFV2ComposerTitle extends Component {
  #model;
  #titleModel;

  get model() {
    return this.args.outletArgs?.model;
  }

  get enabled() {
    return isQuickPost(this.model);
  }

  get titleModel() {
    if (this.#model !== this.model) {
      this.#titleModel?.destroy();
      this.#model = this.model;
      this.#titleModel = OptionalTitleModel.create({ content: this.model });
    }
    return this.#titleModel;
  }

  @action
  identifyInput(element) {
    element.querySelector("input").id = "isbf-optional-title";
  }

  willDestroy() {
    super.willDestroy(...arguments);
    this.#titleModel?.destroy();
  }

  <template>
    {{#if this.enabled}}
      <div class="isbf-v2-composer-title" {{didInsert this.identifyInput}}>
        <ComposerTitle @composer={{this.titleModel}} />
      </div>
    {{/if}}
  </template>
}
