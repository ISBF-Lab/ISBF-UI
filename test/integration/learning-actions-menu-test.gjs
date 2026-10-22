import { click, render } from "@ember/test-helpers";
import { module, test } from "qunit";
import { setupRenderingTest } from "discourse/tests/helpers/component-test";
import ResourceList from "../../discourse/components/isbf-resource-list";

module(
  "ISBF | Integration | Component | LearningActionsMenu",
  function (hooks) {
    setupRenderingTest(hooks);

    hooks.beforeEach(function () {
      this.page = {
        config: { link_sharing: true },
        resources: [],
        canManageResources: true,
        canManageCollectionForm: true,
        selectedCourse: { id: "micro", name: "微观经济学" },
        shareLabel: "分享资料",
        editCourse: () => {},
        editCollectionForm: () => {},
        toggleContributions: () => {},
        share: () => {},
      };
    });

    test("manager actions keep their callbacks and close the menu", async function (assert) {
      this.page.editCourse = (course) => {
        assert.strictEqual(
          course,
          this.page.selectedCourse,
          "editing keeps the selected course"
        );
        assert.step("edit");
      };
      this.page.editCollectionForm = () => assert.step("settings");
      this.page.toggleContributions = () => assert.step("contributions");
      this.page.share = () => assert.step("share");
      await render(<template><ResourceList @page={{this.page}} /></template>);
      assert
        .dom(".isbf-learning-actions-menu")
        .doesNotExist("actions start collapsed");
      for (const name of [
        "edit-course",
        "collection-settings",
        "contributions",
      ]) {
        await click(".isbf-learning__actions-trigger");
        await click(`.isbf-learning-actions-menu .isbf-learning__${name}`);

        assert
          .dom(".isbf-learning-actions-menu")
          .doesNotExist("selecting closes the menu");
      }
      await click(".isbf-learning__header-actions > .isbf-learning__share");
      assert.verifySteps(
        ["edit", "settings", "contributions", "share"],
        "each action calls its existing page callback once"
      );
    });

    test("members keep sharing outside the contributions menu", async function (assert) {
      this.page.canManageResources = false;
      this.page.canManageCollectionForm = false;
      this.page.shareDisabled = true;
      this.page.myContributions = true;
      await render(<template><ResourceList @page={{this.page}} /></template>);
      await click(".isbf-learning__actions-trigger");
      assert
        .dom(".isbf-learning__edit-course")
        .doesNotExist("course editing stays permission guarded");
      assert
        .dom(".isbf-learning__collection-settings")
        .doesNotExist("collection settings stay permission guarded");
      assert
        .dom(".isbf-learning__contributions")
        .hasAttribute("aria-pressed", "true", "contribution state is retained");
      assert
        .dom(".isbf-learning__header-actions > .isbf-learning__share")
        .isDisabled("the existing sharing disabled state is retained");
    });
  }
);
