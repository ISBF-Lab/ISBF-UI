import { tracked } from "@glimmer/tracking";
import Service, { service } from "@ember/service";
import { ajax } from "discourse/lib/ajax";
import AlumniIdentities, { alumniUserId } from "../lib/alumni-identities";

export default class IsbfAlumniIdentity extends Service {
  @service currentUser;
  @service site;

  @tracked memberships = new Map();

  #owner;
  #ownerId;
  #foreground = () => {
    if (document.visibilityState === "visible") {
      this.refresh();
    }
  };
  #state;

  constructor() {
    super(...arguments);
    this.#owner = this.currentUser;
    this.#ownerId = this.currentUser?.id;
    this.#state = new AlumniIdentities({
      request: (ids) =>
        this.enabled
          ? ajax("/isbf/alumni/identities.json", { data: { user_ids: ids } })
          : Promise.resolve({}),
      changed: () => {
        if (!this.isDestroying) {
          this.memberships = this.#state.snapshot();
        }
      },
    });
    document.addEventListener("visibilitychange", this.#foreground);
  }

  willDestroy() {
    document.removeEventListener("visibilitychange", this.#foreground);
    this.#state.destroy();
    super.willDestroy(...arguments);
  }

  get enabled() {
    return this.site.isbf_alumni?.enabled === true;
  }

  isMember(user) {
    const id = alumniUserId(user);
    return (
      this.enabled &&
      this.#owner === this.currentUser &&
      this.#ownerId === this.currentUser?.id &&
      this.memberships.get(id) === true &&
      this.#state.isMember(id)
    );
  }

  watch(user) {
    this.synchronizeAccount();
    const id = alumniUserId(user);
    if (this.enabled && id) {
      this.#state.watch(id);
      return id;
    }
    return null;
  }

  unwatch(id) {
    if (id) {
      this.#state.unwatch(id);
    }
  }

  refresh() {
    this.#owner = this.currentUser;
    this.#ownerId = this.currentUser?.id;
    this.#state.refresh();
  }

  synchronizeAccount() {
    if (
      this.#owner !== this.currentUser ||
      this.#ownerId !== this.currentUser?.id
    ) {
      this.refresh();
    }
  }
}
