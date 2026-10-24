import Component from "@glimmer/component";
import { service } from "@ember/service";
import { themePrefix } from "virtual:theme";
import { i18n } from "discourse-i18n";

export default class ISBFAlumniReviewNav extends Component {
  @service currentUser;
  @service router;

  allHref = "/review?status=pending&type=";
  alumniHref = "/review?status=pending&type=ReviewableIsbfAlumni";

  get visible() {
    const path = this.router.currentURL?.split(/[?#]/, 1)[0] ?? "";
    return (
      /^\/review(?:\/|$)/.test(path) &&
      Boolean(this.currentUser?.can_review) &&
      (this.currentUser.admin === true ||
        this.currentUser.academy_moderator_permissions?.review_alumni === true)
    );
  }

  get activeType() {
    const url = new URL(this.router.currentURL ?? "/", "https://isbf.invalid");
    return /^\/review\/?$/.test(url.pathname)
      ? (url.searchParams.get("type") ?? "")
      : null;
  }

  get allCurrent() {
    return this.activeType === "" ? "page" : undefined;
  }

  get alumniCurrent() {
    return this.activeType === "ReviewableIsbfAlumni" ? "page" : undefined;
  }

  <template>
    {{#if this.visible}}
      <nav
        aria-label={{i18n (themePrefix "isbf_v2.review_filters")}}
        class="isbf-alumni-review-nav"
      >
        <a aria-current={{this.allCurrent}} href={{this.allHref}}>
          {{i18n (themePrefix "isbf_v2.review_all")}}
        </a>
        <a aria-current={{this.alumniCurrent}} href={{this.alumniHref}}>
          {{i18n (themePrefix "isbf_v2.review_alumni")}}
        </a>
      </nav>
    {{/if}}
  </template>
}
