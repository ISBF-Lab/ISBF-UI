import { themePrefix } from "virtual:theme";
import { apiInitializer } from "discourse/lib/api";
import Composer from "discourse/models/composer";
import { i18n } from "discourse-i18n";
import { extendComposerMethod } from "../lib/composer-model-extensions";
import {
  isOfficialComposer,
  OFFICIAL_FIELDS,
  officialConfig,
  officialPayload,
  officialSelectionsComplete,
  restoreOfficialSelections,
} from "../lib/official-filters";

export default apiInitializer((api) => {
  OFFICIAL_FIELDS.forEach((field, index) => {
    const property =
      index === 0 ? "isbfOfficialCampusesPayload" : "isbfOfficialTypesPayload";
    Composer.serializeOnCreate(field, property);
    Composer.serializeOnUpdate(field, property);
    Composer.serializeToDraft(field, field);
  });

  api.addModelGetter("composer", "isbfOfficialCampusesPayload", function () {
    return officialPayload(this, officialConfig(this.site), OFFICIAL_FIELDS[0]);
  });
  api.addModelGetter("composer", "isbfOfficialTypesPayload", function () {
    return officialPayload(this, officialConfig(this.site), OFFICIAL_FIELDS[1]);
  });

  extendComposerMethod(api, "clearState", function (next, ...args) {
    const result = next(...args);
    this.setProperties({
      isbf_official_campuses: null,
      isbf_official_types: null,
    });
    return result;
  });
  extendComposerMethod(api, "open", function (next, ...args) {
    return next(...args).then((result) => {
      restoreOfficialSelections(this, officialConfig(this.site));
      return result;
    });
  });
  extendComposerMethod(api, "save", function (next, ...args) {
    const config = officialConfig(this.site);
    if (
      isOfficialComposer(this, config) &&
      !officialSelectionsComplete(this, config)
    ) {
      return Promise.resolve(
        this.dialog.alert(i18n(themePrefix("isbf_v2.official_required"))),
      );
    }
    return next(...args);
  });
});
