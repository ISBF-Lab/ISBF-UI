import { tracked } from "@glimmer/tracking";
import Controller from "@ember/controller";

export default class IsbfCalendarController extends Controller {
  @tracked entryId = null;

  queryParams = [{ entryId: "entry_id" }];
}
