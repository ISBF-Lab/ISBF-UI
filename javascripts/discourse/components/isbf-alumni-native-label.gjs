import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import didUpdate from "@ember/render-modifiers/modifiers/did-update";
import { cancel, scheduleOnce } from "@ember/runloop";
import { service } from "@ember/service";
import { nativeAlumniTarget } from "../lib/alumni-label-targets";
import ISBFAlumniLabel from "./isbf-alumni-label";

export default class ISBFAlumniNativeLabel extends Component {
  @service siteSettings;

  @tracked target;

  #anchor;
  #scheduled;

  willDestroy() {
    cancel(this.#scheduled);
    super.willDestroy(...arguments);
  }

  get user() {
    return this.args.outletArgs.user || this.args.outletArgs.model;
  }

  @action
  inserted(element) {
    this.#anchor = element;
    this.schedule();
  }

  @action
  schedule() {
    this.#scheduled = scheduleOnce("afterRender", this, this.locate);
  }

  locate() {
    if (!this.isDestroying && this.#anchor?.isConnected) {
      this.target = nativeAlumniTarget(this.#anchor);
    }
  }

  <template>
    <span
      hidden
      {{didInsert this.inserted}}
      {{didUpdate
        this.schedule
        this.user
        this.user.id
        this.user.username
        this.user.name
        this.siteSettings.prioritize_username_in_ux
        this.siteSettings.enable_names
      }}
    ></span>
    {{#if this.target}}
      {{#in-element this.target insertBefore=null}}
        <ISBFAlumniLabel @user={{this.user}} />
      {{/in-element}}
    {{/if}}
  </template>
}
