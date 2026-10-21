import { render } from "@ember/test-helpers";
import { module, test } from "qunit";
import { setupRenderingTest } from "discourse/tests/helpers/component-test";
import ResourceItem from "../../discourse/components/isbf-resource-item";

module("ISBF | Integration | Component | ResourceLayout", function (hooks) {
  setupRenderingTest(hooks, { stubRouter: true });

  hooks.beforeEach(function () {
    this.resource = {
      id: "layout-resource",
      title: "25级微观经济学课件（学院课件）",
      created_at: "2026-10-15T08:00:00Z",
      contributor: "Yin",
      author: { name: "Uploader", username: "uploader" },
      description: "课程复习资料",
      files: [],
      links: [],
    };
  });

  for (const library of [false, true]) {
    test(`${library ? "library" : "learning"} keeps the date beside the contributor below the content`, async function (assert) {
      this.library = library;
      await render(
        <template>
          <ResourceItem @library={{this.library}} @resource={{this.resource}} />
        </template>
      );
      assert
        .dom(".isbf-learning-resource__header time")
        .doesNotExist("the date leaves room for the title");
      assert
        .dom("footer time")
        .hasAttribute(
          "datetime",
          this.resource.created_at,
          "the footer retains the resource date"
        );
      assert
        .dom("footer .isbf-learning-resource__credit")
        .includesText("Yin", "the same row contains the contributor");
    });

    test(`${library ? "library" : "learning"} hides an omitted contributor even when an author exists`, async function (assert) {
      this.library = library;
      this.resource = { ...this.resource, contributor: "   " };
      await render(
        <template>
          <ResourceItem @library={{this.library}} @resource={{this.resource}} />
        </template>
      );
      assert
        .dom(".isbf-learning-resource__credit")
        .doesNotExist(
          "an empty contributor produces no label or author fallback"
        );
      assert.dom("footer time").exists("the date remains visible");
    });
  }
});
