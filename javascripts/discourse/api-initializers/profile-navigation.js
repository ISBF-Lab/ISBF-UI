import { registerDestructor } from "@ember/destroyable";
import { scheduleOnce } from "@ember/runloop";
import { apiInitializer } from "discourse/lib/api";
import ProfileNavigation from "../lib/profile-navigation";

export default apiInitializer((api) => {
  const navigations = new Map();
  let destroyed = false;

  function refresh() {
    if (destroyed) {
      return;
    }
    const elements = document.querySelector(".isbf-v2-shell--profile")
      ? document.querySelectorAll(".user-main .user-navigation")
      : [];
    const current = new Set(elements);
    for (const [element, navigation] of navigations) {
      if (!current.has(element)) {
        navigation.destroy();
        navigations.delete(element);
      }
    }
    for (const element of elements) {
      if (
        !navigations.has(element) &&
        element.querySelector(".d-overflow-controls ul.nav-pills")
      ) {
        navigations.set(element, new ProfileNavigation(element));
      }
    }
  }

  api.onPageChange(() => scheduleOnce("afterRender", refresh));
  scheduleOnce("afterRender", refresh);
  registerDestructor(api.container.lookup("service:router"), () => {
    destroyed = true;
    navigations.forEach((navigation) => navigation.destroy());
    navigations.clear();
  });
});
