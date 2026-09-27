import Component from "@glimmer/component";
import { service } from "@ember/service";
import { settings, themePrefix } from "virtual:theme";
import dAvatar from "discourse/ui-kit/helpers/d-avatar";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";

import ISBFV2RightRail from "./isbf-v2-right-rail";
import ISBFV2SideNav from "./isbf-v2-side-nav";

export default class ISBFV2Shell extends Component {
  @service currentUser;
  @service router;

  get routeName() {
    return this.router.currentRouteName ?? "";
  }

  get isDiscovery() {
    return (
      this.routeName === "discovery" ||
      this.routeName.startsWith("discovery.") ||
      this.routeName.startsWith("tag.")
    );
  }

  get isHome() {
    return this.isDiscovery && !this.routeName.includes("category") && !this.routeName.startsWith("tag.");
  }

  get recommendedActive() {
    return (this.router.currentURL ?? "").startsWith(settings.recommended_path);
  }

  get latestActive() {
    const path = this.router.currentURL ?? "";
    return path === "/" || path.startsWith("/latest");
  }

  get profileHref() {
    return this.currentUser ? `/u/${this.currentUser.username}` : "/login";
  }

  get notificationsHref() {
    return this.currentUser
      ? `/u/${this.currentUser.username}/notifications`
      : "/login";
  }

  <template>
    {{#if this.isDiscovery}}
      <div class="isbf-v2-shell {{if this.isHome 'isbf-v2-shell--home'}}">
        <ISBFV2SideNav />
        {{#if settings.show_right_rail}}<ISBFV2RightRail />{{/if}}

        <header class="isbf-v2-feed-header">
          <div class="isbf-v2-feed-header__title">{{i18n (themePrefix "isbf_v2.home")}}</div>
          <nav aria-label={{i18n (themePrefix "isbf_v2.feed_label")}}>
            <a class={{if this.recommendedActive "is-active"}} href={{settings.recommended_path}} aria-current={{if this.recommendedActive "page"}}>{{i18n (themePrefix "isbf_v2.recommended")}}</a>
            <a class={{if this.latestActive "is-active"}} href="/latest" aria-current={{if this.latestActive "page"}}>{{i18n (themePrefix "isbf_v2.latest")}}</a>
          </nav>
        </header>

        <div class="isbf-v2-compose">
          {{#if this.currentUser}}
            <a href={{this.profileHref}} class="isbf-v2-compose__avatar" aria-label={{this.currentUser.username}}>{{dAvatar this.currentUser imageSize="large"}}</a>
          {{/if}}
          <a class="isbf-v2-compose__prompt" href="/new-topic">{{i18n (themePrefix "isbf_v2.compose_prompt")}}</a>
          <a class="isbf-v2-compose__button" href="/new-topic">{{i18n (themePrefix "isbf_v2.compose")}}</a>
        </div>

        <nav class="isbf-v2-mobile-nav" aria-label={{i18n (themePrefix "isbf_v2.quick_label")}}>
          <a href="/latest">{{dIcon "house"}}<span>{{i18n (themePrefix "isbf_v2.home")}}</span></a>
          <a href="/categories">{{dIcon "magnifying-glass"}}<span>{{i18n (themePrefix "isbf_v2.explore")}}</span></a>
          <a href="/new-topic" class="isbf-v2-mobile-nav__compose">{{dIcon "plus"}}<span>{{i18n (themePrefix "isbf_v2.compose")}}</span></a>
          <a href={{this.notificationsHref}}>{{dIcon "bell"}}<span>{{i18n (themePrefix "isbf_v2.notifications")}}</span></a>
          <a href={{this.profileHref}}>{{dIcon "user"}}<span>{{i18n (themePrefix "isbf_v2.profile")}}</span></a>
        </nav>
      </div>
    {{/if}}
  </template>
}
