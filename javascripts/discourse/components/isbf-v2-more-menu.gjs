import Component from "@glimmer/component";
import { themePrefix } from "virtual:theme";
import DMenu from "discourse/float-kit/components/d-menu";
import { i18n } from "discourse-i18n";
import ISBFV2UtilityActions from "./isbf-v2-utility-actions";

export default class ISBFV2MoreMenu extends Component {
  fallbackPlacements = ["top-start", "top-end"];

  <template>
    <DMenu
      @ariaLabel={{i18n (themePrefix "isbf_v2.sidebar_more")}}
      @contentClass="isbf-v2-more-menu"
      @fallbackPlacements={{this.fallbackPlacements}}
      @icon="ellipsis"
      @identifier="isbf-v2-sidebar-more"
      @label={{i18n (themePrefix "isbf_v2.sidebar_more")}}
      @placement="top-start"
      @title={{i18n (themePrefix "isbf_v2.sidebar_more")}}
      @triggerClass="btn-flat isbf-v2-side__more"
    >
      <:content as |menu|>
        <ISBFV2UtilityActions @menu={{menu}} />
      </:content>
    </DMenu>
  </template>
}
