import { apiInitializer } from "discourse/lib/api";

import ISBFV2Shell from "../components/isbf-v2-shell";

export default apiInitializer((api) => {
  api.renderInOutlet("above-main-container", ISBFV2Shell);

  // Discourse's own mobile topic renderer already has an avatar, title,
  // excerpt, categories, tags, reply count and activity time.
  api.registerValueTransformer(
    "topic-list-item-mobile-layout",
    ({ value, context }) =>
      context?.listContext === "discovery" ? true : value
  );

  api.registerValueTransformer("topic-list-item-class", ({ value, context }) => {
    if (context?.listContext !== "discovery") {
      return value;
    }

    return value.includes("isbf-v2-topic")
      ? value
      : [...value, "isbf-v2-topic"];
  });

  api.registerValueTransformer(
    "topic-list-item-expand-pinned",
    ({ value, context }) =>
      context?.listContext === "discovery" ? true : value
  );
});
