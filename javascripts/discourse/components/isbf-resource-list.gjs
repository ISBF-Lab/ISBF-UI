import { themePrefix } from "virtual:theme";
import DButton from "discourse/ui-kit/d-button";
import dConcatClass from "discourse/ui-kit/helpers/d-concat-class";
import { i18n } from "discourse-i18n";
import ISBFLearningActionsMenu from "./isbf-learning-actions-menu";
import ISBFResourceItem from "./isbf-resource-item";

export default <template>
  <section
    aria-busy={{@page.resourcesLoading}}
    aria-label={{@page.contentTitle}}
    class="isbf-learning__content"
  >
    <div
      class={{dConcatClass
        "isbf-learning__content-header"
        (unless @page.isLibrary "has-actions-menu")
      }}
    >
      <h2 title={{@page.contentTitle}}>{{@page.contentTitle}}</h2>
      {{#if @page.isLibrary}}
        <DButton
          class="btn-primary isbf-learning__share"
          @action={{@page.share}}
          @disabled={{@page.shareDisabled}}
          @translatedLabel={{@page.shareLabel}}
        />
      {{else}}
        <ISBFLearningActionsMenu @page={{@page}} />
      {{/if}}
    </div>
    {{#unless @page.config.link_sharing}}<p
        class="isbf-learning__notice"
        role="status"
      >{{i18n
          (themePrefix "isbf_v2.learning_share_unavailable")
        }}</p>{{/unless}}
    {{#if @page.sharePending}}<p
        class="isbf-learning__notice"
        role="status"
      >{{i18n (themePrefix "isbf_v2.learning_share_pending")}}</p>{{/if}}
    {{#if @page.searching}}<p class="isbf-learning__hint">{{i18n
          (themePrefix
            (if
              @page.isLibrary
              "isbf_v2.library_search_hint"
              "isbf_v2.learning_search_hint"
            )
          )
        }}</p>{{/if}}
    {{#each @page.resources key="id" as |resource|}}<ISBFResourceItem
        @contributions={{@page.myContributions}}
        @grades={{@page.parents}}
        @library={{@page.isLibrary}}
        @onDeleted={{@page.resourceDeleted}}
        @onEdit={{@page.editResource}}
        @resource={{resource}}
        @searching={{@page.searching}}
      />{{/each}}
    {{#if @page.resourcesLoading}}<p
        class="isbf-learning__notice"
        role="status"
      >{{i18n (themePrefix "isbf_v2.learning_loading")}}</p>
    {{else if @page.resourcesError}}
      <p class="isbf-learning__notice" role="alert">{{i18n
          (themePrefix "isbf_v2.learning_load_error")
        }}</p>
      <DButton
        @action={{@page.retryResources}}
        @translatedLabel={{i18n (themePrefix "isbf_v2.explore_retry")}}
      />
    {{else if @page.resources.length}}
      {{#if @page.hasMore}}<DButton
          class="isbf-learning__load-more"
          @action={{@page.loadMore}}
          @translatedLabel={{i18n (themePrefix "isbf_v2.load_more")}}
        />{{/if}}
    {{else if @page.myContributions}}<p class="isbf-learning__notice">{{i18n
          (themePrefix "isbf_v2.learning_contributions_empty")
        }}</p>
    {{else}}<p class="isbf-learning__notice">{{i18n
          (themePrefix
            (if
              @page.isLibrary "isbf_v2.library_empty" "isbf_v2.learning_empty"
            )
          )
        }}</p>{{/if}}
  </section>
</template>
