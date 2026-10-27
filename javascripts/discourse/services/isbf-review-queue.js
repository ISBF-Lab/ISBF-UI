import { tracked } from "@glimmer/tracking";
import { addObserver, removeObserver } from "@ember/object/observers";
import Service, { service } from "@ember/service";
import { ajax } from "discourse/lib/ajax";

const ACTOR_PATHS = ["currentUser", "currentUser.id", "currentUser.can_review"];

export default class ISBFReviewQueue extends Service {
  @service appEvents;
  @service currentUser;
  @service router;

  #actor = null;

  #actorId = null;
  #authorized = false;
  #dirty = false;
  #request = null;
  #started = false;
  #refresh = () => this.#load();
  #visibilityChanged = () => {
    if (document.visibilityState === "visible") {
      this.#load();
    }
  };
  @tracked _count = null;

  willDestroy() {
    if (this.#started) {
      this.appEvents.off("user-reviewable-count:changed", this.#refresh);
      this.router.off("routeDidChange", this.#refresh);
      document.removeEventListener("visibilitychange", this.#visibilityChanged);
      for (const path of ACTOR_PATHS) {
        removeObserver(this, path, this, this.#refresh);
      }
    }
    this.#started = false;
    this.#request = null;
    this.#dirty = false;
    this._count = null;
    this.#actor = null;
    super.willDestroy(...arguments);
  }

  get canReview() {
    return Boolean(this.currentUser?.can_review);
  }

  get hasPending() {
    return (
      this.canReview &&
      this.currentUser === this.#actor &&
      this.currentUser?.id === this.#actorId &&
      this._count > 0
    );
  }

  start() {
    if (this.#started || this.isDestroying) {
      return;
    }
    this.#started = true;
    this.appEvents.on("user-reviewable-count:changed", this.#refresh);
    this.router.on("routeDidChange", this.#refresh);
    document.addEventListener("visibilitychange", this.#visibilityChanged);
    for (const path of ACTOR_PATHS) {
      // Account permission changes must invalidate in-flight responses immediately.
      // eslint-disable-next-line ember/no-observers
      addObserver(this, path, this, this.#refresh, true);
    }
    this.#load();
  }

  #load() {
    if (!this.#started || this.isDestroying) {
      return;
    }
    if (
      this.#actor !== this.currentUser ||
      this.#actorId !== this.currentUser?.id ||
      this.#authorized !== this.canReview
    ) {
      this.#actor = this.currentUser;
      this.#actorId = this.currentUser?.id;
      this.#authorized = this.canReview;
      this._count = null;
      this.#request = null;
      this.#dirty = false;
    }
    if (!this.canReview) {
      return;
    }
    if (this.#request) {
      this.#dirty = true;
      return;
    }
    const request = {
      actor: this.currentUser,
      actorId: this.currentUser?.id,
    };
    this.#request = request;
    this.#fetch(request);
  }

  async #fetch(request) {
    try {
      const result = await ajax("/review/count.json");
      if (
        this.#request === request &&
        !this.isDestroying &&
        this.canReview &&
        this.currentUser === request.actor &&
        this.currentUser?.id === request.actorId &&
        Number.isInteger(result?.count) &&
        result.count >= 0
      ) {
        this._count = result.count;
      }
    } catch {
      // Keep the last confirmed count until a later refresh succeeds.
    } finally {
      if (this.#request === request) {
        this.#request = null;
        if (this.#dirty) {
          this.#dirty = false;
          this.#load();
        }
      }
    }
  }
}
