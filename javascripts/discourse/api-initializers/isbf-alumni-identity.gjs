import { getOwner } from "@ember/owner";
import { apiInitializer } from "discourse/lib/api";
import ISBFAlumniNativeLabel from "../components/isbf-alumni-native-label";
import ISBFAlumniSearchLabels from "../components/isbf-alumni-search-labels";
import IsbfAlumniIdentity from "../services/isbf-alumni-identity";

export default apiInitializer((api) => {
  const owner = getOwner(api.container.lookup("service:router"));
  if (!owner.hasRegistration("service:isbf-alumni-identity")) {
    owner.register("service:isbf-alumni-identity", IsbfAlumniIdentity);
  }
  const identity = owner.lookup("service:isbf-alumni-identity");
  for (const outlet of [
    "user-post-names",
    "user-card-after-username",
    "after-user-name",
  ]) {
    api.renderInOutlet(outlet, ISBFAlumniNativeLabel);
  }
  for (const outlet of [
    "full-page-search-below-results",
    "search-menu-results-type-top",
  ]) {
    api.renderInOutlet(outlet, ISBFAlumniSearchLabels);
  }
  api.onPageChange(() => identity.refresh());
});
