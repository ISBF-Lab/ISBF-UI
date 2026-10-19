import { click, fillIn, getRootElement, render } from "@ember/test-helpers";
import { module, test } from "qunit";
import { setupRenderingTest } from "discourse/tests/helpers/component-test";
import pretender, { response } from "discourse/tests/helpers/create-pretender";
import CollectionFormDialog from "../../discourse/components/isbf-learning-collection-form-dialog";

module(
  "ISBF | Integration | Component | LearningCollectionFormDialog",
  function (hooks) {
    setupRenderingTest(hooks, { stubRouter: true });

    hooks.beforeEach(function () {
      this.owner.lookup("service:modal").setContainerElement(getRootElement());
      this.siteSettings.isbf_learning_collection_form_url =
        "https://f.wps.cn/g/wG6gL3Rz/";
      this.currentUser.setProperties({
        admin: false,
        academy_moderator_permissions: { manage_resources: true },
      });
      this.onClose = () => {};
      this.onSaved = () => {};
    });

    test("a delegated manager can save a valid link on another domain", async function (assert) {
      let saved;
      pretender.put("/isbf/learning/collection-form", (request) => {
        saved = new URLSearchParams(request.requestBody).get("url");
        return response({ success: true, url: saved });
      });
      this.onSaved = () => assert.step("saved");
      await render(
        <template>
          <CollectionFormDialog
            @onClose={{this.onClose}}
            @onSaved={{this.onSaved}}
          />
        </template>
      );
      assert
        .dom('input[name="url"]')
        .hasValue(
          "https://f.wps.cn/g/wG6gL3Rz/",
          "the current destination is prefilled"
        );
      await fillIn(
        'input[name="url"]',
        "https://forms.example.edu/learning?year=2026"
      );
      await click('button[type="submit"]');
      assert.strictEqual(
        saved,
        "https://forms.example.edu/learning?year=2026",
        "a valid URL needs no WPS domain restriction"
      );
      assert.strictEqual(
        this.siteSettings.isbf_learning_collection_form_url,
        saved,
        "future share dialogs use the saved destination"
      );
      assert.verifySteps(
        ["saved"],
        "successful saving closes through the owning page"
      );
    });

    test("an invalid URL keeps the form open without submitting", async function (assert) {
      let saves = 0;
      pretender.put("/isbf/learning/collection-form", () => {
        saves++;
        return response({});
      });
      await render(
        <template>
          <CollectionFormDialog
            @onClose={{this.onClose}}
            @onSaved={{this.onSaved}}
          />
        </template>
      );
      await fillIn('input[name="url"]', "not a link");
      await click('button[type="submit"]');
      assert.strictEqual(saves, 0, "invalid links are not sent");
      assert
        .dom('input[name="url"]')
        .hasValue("not a link", "the draft remains available for correction");
    });

    test("ordinary users and review-only moderators have no editing form", async function (assert) {
      this.currentUser.setProperties({
        admin: false,
        academy_moderator_permissions: {
          manage_resources: false,
          review_resources: true,
        },
      });
      await render(
        <template>
          <CollectionFormDialog
            @onClose={{this.onClose}}
            @onSaved={{this.onSaved}}
          />
        </template>
      );
      assert
        .dom(".isbf-learning-collection-form-dialog form")
        .doesNotExist(
          "review permission alone cannot configure submission links"
        );
    });

    test("a server failure preserves the draft and allows retry", async function (assert) {
      pretender.put("/isbf/learning/collection-form", () =>
        response(422, { errors: ["Link save failed"] })
      );
      await render(
        <template>
          <CollectionFormDialog
            @onClose={{this.onClose}}
            @onSaved={{this.onSaved}}
          />
        </template>
      );
      await fillIn('input[name="url"]', "https://forms.example.edu/learning");
      await click('button[type="submit"]');
      assert
        .dom('[role="alert"]')
        .includesText("Link save failed", "the server error is shown");
      assert
        .dom('input[name="url"]')
        .hasValue(
          "https://forms.example.edu/learning",
          "a failed save keeps the draft"
        );
      assert
        .dom('button[type="submit"]')
        .isEnabled("the manager can retry saving");
    });
  }
);
