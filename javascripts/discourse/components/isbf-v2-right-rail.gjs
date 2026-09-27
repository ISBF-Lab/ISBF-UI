import Component from "@glimmer/component";
import { themePrefix } from "virtual:theme";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";

export default class ISBFV2RightRail extends Component {
  <template>
    <aside class="isbf-v2-rail" aria-label={{i18n (themePrefix "isbf_v2.popular")}}>
      <form class="isbf-v2-rail__search" action="/search" method="get" role="search">
        {{dIcon "magnifying-glass"}}
        <label class="sr-only" for="isbf-v2-search">{{i18n (themePrefix "isbf_v2.search")}}</label>
        <input id="isbf-v2-search" name="q" type="search" autocomplete="off" placeholder={{i18n (themePrefix "isbf_v2.search_placeholder")}} />
      </form>

      <section class="isbf-v2-rail__panel" aria-labelledby="isbf-v2-popular-title">
        <h2 id="isbf-v2-popular-title">{{i18n (themePrefix "isbf_v2.popular")}}</h2>
        <p>{{i18n (themePrefix "isbf_v2.rail_description")}}</p>
        <a href="/hot"><span>{{i18n (themePrefix "isbf_v2.hot")}}</span>{{dIcon "chevron-right"}}</a>
        <a href="/top"><span>{{i18n (themePrefix "isbf_v2.top")}}</span>{{dIcon "chevron-right"}}</a>
        <a href="/categories"><span>{{i18n (themePrefix "isbf_v2.categories")}}</span>{{dIcon "chevron-right"}}</a>
      </section>
    </aside>
  </template>
}
