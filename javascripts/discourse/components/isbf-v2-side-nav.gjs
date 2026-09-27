import Component from "@glimmer/component";
import { service } from "@ember/service";
import { settings, themePrefix } from "virtual:theme";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";

export default class ISBFV2SideNav extends Component {
  @service currentUser;
  @service router;

  get avatarUrl() {
    return this.currentUser?.avatar_template?.replace("{size}", "96");
  }

  get displayName() {
    return this.currentUser?.name || this.currentUser?.username;
  }

  get bookmarksHref() {
    return this.currentUser
      ? `/u/${this.currentUser.username}/activity/bookmarks`
      : "/login";
  }

  get notificationsHref() {
    return this.currentUser
      ? `/u/${this.currentUser.username}/notifications`
      : "/login";
  }

  get profileHref() {
    return this.currentUser ? `/u/${this.currentUser.username}` : "/login";
  }

  get homeActive() {
    const path = this.router.currentURL ?? "";
    const officialPath = settings.official_path.split("/l/")[0];

    return (
      path === "/" ||
      path.startsWith("/latest") ||
      path === officialPath ||
      path.startsWith(`${officialPath}/`)
    );
  }

  <template>
    <aside class="isbf-v2-side" aria-label={{i18n (themePrefix "isbf_v2.navigation_label")}}>
      <a class="isbf-v2-brand" href="/latest" aria-label={{settings.brand_name}}>
        <span class="isbf-v2-brand__mark" aria-hidden="true">I</span>
        <span class="isbf-v2-brand__name">{{settings.brand_name}}</span>
      </a>

      <nav class="isbf-v2-side__links">
        <a class={{if this.homeActive "is-active"}} href="/latest">{{dIcon "house"}}<span>{{i18n (themePrefix "isbf_v2.home")}}</span></a>
        <a href="/categories">{{dIcon "magnifying-glass"}}<span>{{i18n (themePrefix "isbf_v2.explore")}}</span></a>
        <a href={{this.notificationsHref}}>{{dIcon "bell"}}<span>{{i18n (themePrefix "isbf_v2.notifications")}}</span></a>
        <a href={{this.bookmarksHref}}>{{dIcon "bookmark"}}<span>{{i18n (themePrefix "isbf_v2.bookmarks")}}</span></a>
        <a href={{this.profileHref}}>{{dIcon "user"}}<span>{{i18n (themePrefix "isbf_v2.profile")}}</span></a>
      </nav>

      <a class="isbf-v2-side__compose" href="/new-topic">{{i18n (themePrefix "isbf_v2.compose")}}</a>

      {{#if this.currentUser}}
        <a class="isbf-v2-side__account" href={{this.profileHref}}>
          <img src={{this.avatarUrl}} alt="" width="40" height="40" />
          <span><b>{{this.displayName}}</b><small>@{{this.currentUser.username}}</small></span>
        </a>
      {{/if}}
    </aside>
  </template>
}
