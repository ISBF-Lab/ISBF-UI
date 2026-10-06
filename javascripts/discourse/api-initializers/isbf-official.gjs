import { themePrefix } from "virtual:theme";
import { apiInitializer } from "discourse/lib/api";
import Composer from "discourse/models/composer";
import { i18n } from "discourse-i18n";
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

  api.modifyClass("model:composer", {
    pluginId: "isbf-ui-official-filters",

    get isbfOfficialCampusesPayload() {
      return officialPayload(
        this,
        officialConfig(this.site),
        OFFICIAL_FIELDS[0]
      );
    },

    get isbfOfficialTypesPayload() {
      return officialPayload(
        this,
        officialConfig(this.site),
        OFFICIAL_FIELDS[1]
      );
    },

    clearState() {
      this._super(...arguments);
      this.setProperties({
        isbf_official_campuses: null,
        isbf_official_types: null,
      });
    },

    open() {
      return this._super(...arguments).then((result) => {
        restoreOfficialSelections(this, officialConfig(this.site));
        return result;
      });
    },

    save() {
      const config = officialConfig(this.site);
      if (
        isOfficialComposer(this, config) &&
        !officialSelectionsComplete(this, config)
      ) {
        return Promise.resolve(
          this.dialog.alert(i18n(themePrefix("isbf_v2.official_required")))
        );
      }
      return this._super(...arguments);
    },
  });
});
