import { registerDestructor } from "@ember/destroyable";
import { scheduleOnce } from "@ember/runloop";
import { apiInitializer } from "discourse/lib/api";

const SECTIONS = new Set([
  "activity",
  "badges",
  "invited",
  "messages",
  "notifications",
  "preferences",
  "summary",
]);

export default apiInitializer((api) => {
  let current;
  let destroyed = false;

  function clear() {
    current?.classList.remove("isbf-profile-content");
    if (current) {
      delete current.dataset.profileSection;
    }
    current = null;
  }

  function refresh() {
    if (destroyed) {
      return;
    }
    const next = document.querySelector(".isbf-v2-shell--profile")
      ? document.querySelector(".user-main .new-user-content-wrapper")
      : null;
    if (current !== next) {
      clear();
      current = next;
    }
    if (current) {
      const href = document
        .querySelector(".user-navigation-primary a.active")
        ?.getAttribute("href");
      const section = href?.split("/")[3];
      current.classList.add("isbf-profile-content");
      current.dataset.profileSection = SECTIONS.has(section) ? section : "";
    }
  }

  api.onPageChange(() => scheduleOnce("afterRender", refresh));
  scheduleOnce("afterRender", refresh);
  registerDestructor(api.container.lookup("service:router"), () => {
    destroyed = true;
    clear();
  });
});
