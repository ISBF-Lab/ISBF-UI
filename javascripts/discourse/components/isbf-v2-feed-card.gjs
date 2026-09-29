import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { scheduleOnce } from "@ember/runloop";
import { service } from "@ember/service";
import { htmlSafe } from "@ember/template";
import Composer from "discourse/models/composer";
import { ajax } from "discourse/lib/ajax";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";
import { themePrefix } from "virtual:theme";

import { loadCookedPost, loadRepostCount } from "../lib/feed-post-loader";

function plainText(html) {
  const element = document.createElement("div");
  element.innerHTML = html ?? "";
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function compactNumber(value) {
  const count = Number(value) || 0;
  return count ? new Intl.NumberFormat(undefined, { notation: "compact" }).format(count) : "";
}

export default class ISBFV2FeedCard extends Component {
  @service composer;
  @service currentUser;
  @service dialog;
  @service router;

  @tracked body = null;
  @tracked bodyFailed = false;
  @tracked bookmarked;
  @tracked expanded = false;
  @tracked isLiking = false;
  @tracked liked;
  @tracked likeCount;
  @tracked menuOpen = false;
  @tracked repostCount = null;

  #observer;
  #rootElement;

  constructor() {
    super(...arguments);
    this.bookmarked = Boolean(this.args.topic.bookmarked);
    this.liked = Boolean(this.args.topic.op_liked);
    this.likeCount = Number(this.args.topic.op_like_count) || 0;
  }

  willDestroy() {
    super.willDestroy(...arguments);
    this.#observer?.disconnect();
    document.removeEventListener("pointerdown", this.onOutsidePointer, true);
    document.removeEventListener("keydown", this.onDocumentKeydown, true);
  }

  get avatarUrl() {
    return this.args.topic.creator?.avatar_template?.replace("{size}", "96");
  }

  get bodyHtml() {
    if (this.body) {
      return htmlSafe(this.body);
    }
    if (this.args.topic.excerpt) {
      return htmlSafe(`<p>${this.args.topic.excerpt}</p>`);
    }
    return null;
  }

  get canFlag() {
    return Boolean(this.currentUser) && this.currentUser.id !== this.args.topic.creator?.id;
  }

  get canLike() {
    return Boolean(this.currentUser) && (this.args.topic.op_can_like || this.liked);
  }

  get creatorName() {
    return this.args.topic.creator?.name || this.args.topic.creator?.username;
  }

  get displayTitle() {
    if (!this.body) {
      return null;
    }
    const title = this.args.topic.title?.replace(/\s+/g, " ").trim();
    const body = plainText(this.body);
    if (!title || body.startsWith(title) || title.startsWith(body.slice(0, 80))) {
      return null;
    }
    return title;
  }

  get formattedLikeCount() {
    return compactNumber(this.likeCount);
  }

  get formattedReplyCount() {
    return compactNumber(this.args.topic.replyCount);
  }

  get formattedRepostCount() {
    return compactNumber(this.repostCount);
  }

  get profileUrl() {
    return `/u/${this.args.topic.creator?.username}`;
  }

  get showExpand() {
    return plainText(this.body || this.args.topic.excerpt).length > 900;
  }

  get relativeTime() {
    const date = new Date(this.args.topic.createdAt);
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    if (Math.abs(seconds) < 60) {
      return formatter.format(seconds, "second");
    }
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) {
      return formatter.format(minutes, "minute");
    }
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) {
      return formatter.format(hours, "hour");
    }
    return formatter.format(Math.round(hours / 24), "day");
  }

  get topicUrl() {
    return this.args.topic.url;
  }

  @action
  observe(element) {
    this.#rootElement = element;
    this.#observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.#observer.disconnect();
          this.#loadContent();
        }
      },
      { rootMargin: "320px 0px" }
    );
    this.#observer.observe(element);
  }

  @action
  toggleExpanded() {
    this.expanded = !this.expanded;
  }

  @action
  async reply() {
    if (!this.currentUser) {
      this.router.transitionTo("login");
      return;
    }
    await this.composer.open({ action: Composer.REPLY, topic: this.args.topic });
  }

  @action
  async toggleLike() {
    if (!this.canLike || this.isLiking) {
      return;
    }
    this.isLiking = true;
    try {
      if (this.liked) {
        await ajax(`/post_actions/${this.args.topic.first_post_id}`, {
          data: { post_action_type_id: 2 },
          type: "DELETE",
        });
        this.liked = false;
        this.likeCount = Math.max(0, this.likeCount - 1);
      } else {
        await ajax("/post_actions", {
          data: {
            id: this.args.topic.first_post_id,
            post_action_type_id: 2,
          },
          type: "POST",
        });
        this.liked = true;
        this.likeCount += 1;
      }
    } catch (error) {
      await this.#showError(error);
    } finally {
      this.isLiking = false;
    }
  }

  @action
  async toggleBookmark() {
    if (!this.currentUser) {
      this.router.transitionTo("login");
      return;
    }
    try {
      if (this.bookmarked) {
        await ajax(`/t/${this.args.topic.id}/remove_bookmarks`, { type: "PUT" });
      } else {
        await ajax(`/t/${this.args.topic.id}/bookmark`, { type: "PUT" });
      }
      this.bookmarked = !this.bookmarked;
    } catch (error) {
      await this.#showError(error);
    }
  }

  @action
  async repost() {
    if (!this.currentUser) {
      this.router.transitionTo("login");
      return;
    }
    const sourceText = plainText(this.body || this.args.topic.excerpt).slice(0, 500);
    const username = this.args.topic.creator?.username;
    const body = `[quote=\"${username}, post:1, topic:${this.args.topic.id}\"]\n${sourceText}\n[/quote]\n\n`;
    await this.composer.openNewTopic({
      body,
      title: this.args.topic.title,
    });
    this.composer.model?.set(
      "isbf_repost_source_topic_id",
      this.args.topic.id
    );
  }

  @action
  async share() {
    const url = new URL(this.topicUrl, window.location.origin).href;
    try {
      if (navigator.share) {
        await navigator.share({ title: this.args.topic.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        await this.dialog.alert(i18n(themePrefix("isbf_v2.link_copied")));
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        await this.#showError(error);
      }
    }
  }

  @action
  toggleMenu(event) {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
    if (this.menuOpen) {
      document.addEventListener("pointerdown", this.onOutsidePointer, true);
      document.addEventListener("keydown", this.onDocumentKeydown, true);
    } else {
      this.#closeMenu();
    }
  }

  @action
  onOutsidePointer(event) {
    if (!this.#rootElement?.querySelector(".isbf-feed-card__menu-wrap")?.contains(event.target)) {
      this.#closeMenu();
    }
  }

  @action
  onDocumentKeydown(event) {
    if (event.key === "Escape") {
      this.#closeMenu();
      this.#rootElement?.querySelector(".isbf-feed-card__menu-trigger")?.focus();
    }
  }

  @action
  async flag() {
    this.#closeMenu();
    await this.router.transitionTo(this.topicUrl);
    scheduleOnce("afterRender", () => {
      const article = document.querySelector("article[data-post-number='1']");
      article?.querySelector(".show-more-actions")?.click();
      scheduleOnce("afterRender", () => {
        article
          ?.querySelector("button.flag, button.create-flag, [data-key='flag']")
          ?.click();
      });
    });
  }

  async #loadContent() {
    const postId = this.args.topic.first_post_id;
    if (!postId) {
      this.bodyFailed = true;
      return;
    }
    const [body, count] = await Promise.allSettled([
      loadCookedPost(postId),
      loadRepostCount(this.args.topic.id),
    ]);
    if (body.status === "fulfilled") {
      this.body = body.value;
    } else {
      this.bodyFailed = true;
    }
    if (count.status === "fulfilled") {
      this.repostCount = count.value;
    }
  }

  #closeMenu() {
    this.menuOpen = false;
    document.removeEventListener("pointerdown", this.onOutsidePointer, true);
    document.removeEventListener("keydown", this.onDocumentKeydown, true);
  }

  async #showError(error) {
    const message = error?.jqXHR?.responseJSON?.errors?.[0] || i18n(themePrefix("isbf_v2.action_failed"));
    await this.dialog.alert(message);
  }

  <template>
    <article class="isbf-feed-card" {{did-insert this.observe}}>
      <a class="isbf-feed-card__avatar" href={{this.profileUrl}}>
        <img alt="" height="42" loading="lazy" src={{this.avatarUrl}} width="42" />
      </a>
      <div class="isbf-feed-card__main">
        <header class="isbf-feed-card__header">
          <a class="isbf-feed-card__author" href={{this.profileUrl}}>{{this.creatorName}}</a>
          <a class="isbf-feed-card__username" href={{this.profileUrl}}>@{{@topic.creator.username}}</a>
          <span aria-hidden="true">·</span>
          <a class="isbf-feed-card__time" href={{this.topicUrl}} title={{@topic.createdAt}}>{{this.relativeTime}}</a>
          <div class="isbf-feed-card__menu-wrap">
            <button aria-expanded={{if this.menuOpen "true" "false"}} aria-label={{i18n (themePrefix "isbf_v2.more_actions")}} class="isbf-feed-card__menu-trigger" type="button" {{on "click" this.toggleMenu}}>{{dIcon "ellipsis"}}</button>
            {{#if this.menuOpen}}
              <div class="isbf-feed-card__menu" role="menu">
                {{#if this.canFlag}}<button role="menuitem" type="button" {{on "click" this.flag}}>{{dIcon "flag"}}{{i18n (themePrefix "isbf_v2.report")}}</button>{{/if}}
              </div>
            {{/if}}
          </div>
        </header>
        {{#if this.displayTitle}}<a class="isbf-feed-card__title" href={{this.topicUrl}}>{{this.displayTitle}}</a>{{/if}}
        <div class={{if this.expanded "isbf-feed-card__body is-expanded" "isbf-feed-card__body"}}>{{this.bodyHtml}}</div>
        {{#if this.bodyFailed}}<a class="isbf-feed-card__fallback" href={{this.topicUrl}}>{{i18n (themePrefix "isbf_v2.view_post")}}</a>{{/if}}
        {{#if this.showExpand}}<button class="isbf-feed-card__expand" type="button" {{on "click" this.toggleExpanded}}>{{i18n (themePrefix (if this.expanded "isbf_v2.show_less" "isbf_v2.show_more"))}}</button>{{/if}}
        <footer class="isbf-feed-card__actions">
          <button aria-label={{i18n (themePrefix "isbf_v2.reply")}} type="button" {{on "click" this.reply}}>{{dIcon "comment"}}<span>{{this.formattedReplyCount}}</span></button>
          <button aria-label={{i18n (themePrefix "isbf_v2.repost")}} type="button" {{on "click" this.repost}}>{{dIcon "retweet"}}<span>{{this.formattedRepostCount}}</span></button>
          <button aria-label={{i18n (themePrefix "isbf_v2.like")}} class={{if this.liked "is-liked"}} disabled={{this.isLiking}} type="button" {{on "click" this.toggleLike}}>{{dIcon "heart"}}<span>{{this.formattedLikeCount}}</span></button>
          <button aria-label={{i18n (themePrefix "isbf_v2.bookmark_action")}} class={{if this.bookmarked "is-bookmarked"}} type="button" {{on "click" this.toggleBookmark}}>{{dIcon "bookmark"}}</button>
          <button aria-label={{i18n (themePrefix "isbf_v2.share")}} type="button" {{on "click" this.share}}>{{dIcon "share-nodes"}}</button>
        </footer>
      </div>
    </article>
  </template>
}
