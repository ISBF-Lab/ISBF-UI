import {
  click,
  fillIn,
  findAll,
  getRootElement,
  render,
} from "@ember/test-helpers";
import { module, test } from "qunit";
import { themePrefix } from "virtual:theme";
import { setupRenderingTest } from "discourse/tests/helpers/component-test";
import pretender, { response } from "discourse/tests/helpers/create-pretender";
import { i18n } from "discourse-i18n";
import LearningDirectoryEditor from "../../discourse/components/isbf-learning-directory-editor";
import ResourceAddDialog from "../../discourse/components/isbf-resource-add-dialog";
import ResourceCatalog from "../../discourse/components/isbf-resource-catalog";
import ResourceDirectoryDialog from "../../discourse/components/isbf-resource-directory-dialog";

module("ISBF | Integration | Component | ResourceCatalog", function (hooks) {
  setupRenderingTest(hooks, { stubRouter: true });

  hooks.beforeEach(function () {
    this.owner.lookup("service:modal").setContainerElement(getRootElement());
    this.grades = [
      { id: 1, label: "大一" },
      { id: 5, label: "通识课程" },
    ];
    this.onClose = () => {};
    this.onSubmitted = () => {};
  });

  test("directory editing escapes the page column layout", async function (assert) {
    this.entry = { id: "group-a", name: "已有课程", category_id: 1 };
    await render(
      <template>
        <div class="resource-page-column">
          <LearningDirectoryEditor
            @entry={{this.entry}}
            @grades={{this.grades}}
            @kind="course"
            @library={{true}}
            @onClose={{this.onClose}}
            @onSaved={{this.onSubmitted}}
          />
        </div>
      </template>
    );
    assert.dom(".resource-page-column .d-modal").doesNotExist();
    assert
      .dom(".d-modal .form-kit")
      .exists("editing uses the shared modal container");
  });

  test("the sidebar exposes one add entry only to administrators", async function (assert) {
    this.page = {
      parents: this.grades,
      grade: 1,
      courseItems: [{ id: "course-a", name: "已有课程" }],
      canAddDirectories: false,
      changeGrade() {},
      selectCourse() {},
      openAddDialog() {},
    };
    await render(<template><ResourceCatalog @page={{this.page}} /></template>);
    assert
      .dom(".isbf-learning__add-course")
      .doesNotExist("members have no add entry");
    this.set("page", { ...this.page, canAddDirectories: true });
    assert
      .dom(".isbf-learning__add-course")
      .hasText(
        i18n(themePrefix("isbf_v2.resource_add")),
        "administrators see Add"
      );
    assert
      .dom(".isbf-resource-parent .d-icon-plus")
      .doesNotExist("there is no separate category shortcut");
  });

  test("the first modal lets administrators choose a category or course", async function (assert) {
    const choices = [];
    this.choose = (kind) => choices.push(kind);
    await render(
      <template>
        <ResourceAddDialog
          @onChoose={{this.choose}}
          @onClose={{this.onClose}}
        />
      </template>
    );
    await click(".isbf-resource-add-dialog__category");
    await click(".isbf-resource-add-dialog__course");
    assert.deepEqual(
      choices,
      ["category", "group"],
      "each choice reaches its own form"
    );
  });

  test("a course keeps the selected custom category when saved", async function (assert) {
    let submitted;
    pretender.post("/isbf/learning/courses", (request) => {
      submitted = new URLSearchParams(request.requestBody);
      return response({
        success: true,
        pending: false,
        course: { id: "course-new" },
      });
    });
    await render(
      <template>
        <ResourceDirectoryDialog
          @grade={{1}}
          @grades={{this.grades}}
          @kind="group"
          @onClose={{this.onClose}}
          @onSubmitted={{this.onSubmitted}}
        />
      </template>
    );
    await fillIn('input[name="name"]', "通识新课程");
    await click(".isbf-learning-course-dialog .isbf-learning__grade");
    const option = findAll(".isbf-learning-grade-menu button").find(
      (button) => button.textContent.trim() === "通识课程"
    );
    await click(option);
    assert
      .dom(".isbf-learning-course-dialog .isbf-learning__grade")
      .hasText("通识课程", "the visible value changes after selection");
    assert
      .dom('.form-kit__field[data-name="grade"] label')
      .includesText(
        i18n(themePrefix("isbf_v2.library_category")),
        "the field is called Category"
      );
    await click('.isbf-learning-course-dialog button[type="submit"]');
    assert.strictEqual(
      submitted.get("grade"),
      "5",
      "the selected category reaches the backend"
    );
  });

  test("adding a category uses the name-only form and activates its returned identifier", async function (assert) {
    let selected;
    pretender.post("/isbf/learning/grades", () =>
      response(201, {
        success: true,
        pending: false,
        grade: { id: 5, label: "通识课程" },
      })
    );
    this.onSubmitted = (_result, grade) => {
      selected = grade;
    };
    await render(
      <template>
        <ResourceDirectoryDialog
          @grades={{this.grades}}
          @kind="category"
          @onClose={{this.onClose}}
          @onSubmitted={{this.onSubmitted}}
        />
      </template>
    );
    assert
      .dom('.form-kit__field[data-name="grade"]')
      .doesNotExist("a new category has no parent selector");
    await fillIn('input[name="name"]', "通识课程");
    await click('.isbf-learning-course-dialog button[type="submit"]');
    assert.strictEqual(
      selected,
      5,
      "the new category becomes the current selection"
    );
  });

  test("the library course form sends the selected library category", async function (assert) {
    let submitted;
    this.grades = [
      { id: "category-a", label: "考研" },
      { id: "category-b", label: "竞赛" },
    ];
    pretender.post("/isbf/library/groups", (request) => {
      submitted = new URLSearchParams(request.requestBody);
      return response({
        success: true,
        pending: false,
        group: { id: "group-new" },
      });
    });
    await render(
      <template>
        <ResourceDirectoryDialog
          @grade="category-a"
          @grades={{this.grades}}
          @kind="group"
          @library={{true}}
          @onClose={{this.onClose}}
          @onSubmitted={{this.onSubmitted}}
        />
      </template>
    );
    await fillIn('input[name="name"]', "资料库课程");
    await click(".isbf-learning-course-dialog .isbf-learning__grade");
    const option = findAll(".isbf-learning-grade-menu button").find(
      (button) => button.textContent.trim() === "竞赛"
    );
    await click(option);
    await click('.isbf-learning-course-dialog button[type="submit"]');
    assert.strictEqual(
      submitted.get("category_id"),
      "category-b",
      "library category identifiers stay independent"
    );
  });
});
