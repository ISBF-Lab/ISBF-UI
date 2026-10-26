import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import didUpdate from "@ember/render-modifiers/modifiers/did-update";
import { cancel, scheduleOnce } from "@ember/runloop";
import { alumniUserId } from "../lib/alumni-identities";
import { searchAlumniTargets } from "../lib/alumni-label-targets";
import ISBFAlumniLabel from "./isbf-alumni-label";

const EMPTY_USERS = Object.freeze([]);

export default class ISBFAlumniSearchLabels extends Component {
  @tracked targets = [];

  #anchor;
  #scheduled;

  willDestroy() {
    cancel(this.#scheduled);
    super.willDestroy(...arguments);
  }

  get dropdown() {
    return Boolean(this.args.outletArgs.resultType);
  }

  get users() {
    const args = this.args.outletArgs;
    if (this.dropdown) {
      return args.resultType.type === "user"
        ? args.resultType.results
        : EMPTY_USERS;
    }
    return args.model?.users || EMPTY_USERS;
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
      this.targets = searchAlumniTargets(
        this.#anchor,
        this.users.filter((user) => alumniUserId(user)),
        this.dropdown
      );
    }
  }

  <template>
    <span
      hidden
      {{didInsert this.inserted}}
      {{didUpdate
        this.schedule
        this.users
        this.users.length
        @outletArgs.search
        @outletArgs.type
      }}
    ></span>
    {{#each this.targets key="user.id" as |item|}}
      {{#in-element item.target insertBefore=null}}
        <ISBFAlumniLabel @user={{item.user}} />
      {{/in-element}}
    {{/each}}
  </template>
}
