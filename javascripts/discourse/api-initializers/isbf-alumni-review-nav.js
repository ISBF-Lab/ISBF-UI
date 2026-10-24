import { apiInitializer } from "discourse/lib/api";
import ISBFAlumniReviewNav from "../components/isbf-alumni-review-nav";

export default apiInitializer((api) => {
  api.renderInOutlet("top-notices", ISBFAlumniReviewNav);
});
