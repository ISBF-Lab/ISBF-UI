import Component from "@glimmer/component";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import didUpdate from "@ember/render-modifiers/modifiers/did-update";
import { service } from "@ember/service";
import { themePrefix } from "virtual:theme";
import { i18n } from "discourse-i18n";

export default class ISBFAlumniLabel extends Component {
  @service currentUser;
  @service isbfAlumniIdentity;

  #id;

  willDestroy() {
    this.isbfAlumniIdentity.unwatch(this.#id);
    super.willDestroy(...arguments);
  }

  get visible() {
    return this.isbfAlumniIdentity.isMember(this.args.user);
  }

  @action
  observe() {
    this.isbfAlumniIdentity.unwatch(this.#id);
    this.#id = this.isbfAlumniIdentity.watch(this.args.user);
  }

  <template>
    <span
      class="isbf-alumni-label"
      hidden={{unless this.visible true}}
      {{didInsert this.observe}}
      {{didUpdate this.observe @user.id this.currentUser this.currentUser.id}}
    >{{i18n (themePrefix "isbf_v2.alumni_identity")}}</span>
  </template>
}
