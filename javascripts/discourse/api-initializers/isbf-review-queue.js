import { getOwner } from "@ember/owner";
import { apiInitializer } from "discourse/lib/api";
import ISBFReviewQueue from "../services/isbf-review-queue";

export default apiInitializer((api) => {
  const owner = getOwner(api.container.lookup("service:router"));
  if (!owner.hasRegistration("service:isbf-review-queue")) {
    owner.register("service:isbf-review-queue", ISBFReviewQueue);
  }
  owner.lookup("service:isbf-review-queue").start();
});
