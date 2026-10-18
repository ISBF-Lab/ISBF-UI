import { click, fillIn, render, settled } from "@ember/test-helpers";
import { module, test } from "qunit";
import { themePrefix } from "virtual:theme";
import { setupRenderingTest } from "discourse/tests/helpers/component-test";
import pretender, { response } from "discourse/tests/helpers/create-pretender";
import { i18n } from "discourse-i18n";
import LearningDirectoryEditor from "../../discourse/components/isbf-learning-directory-editor";
import LearningManagementDialog from "../../discourse/components/isbf-learning-management-dialog";
import ResourceParentPicker from "../../discourse/components/isbf-resource-parent-picker";

module(
  "ISBF | Integration | Component | LearningManagementDialog",
  function (hooks) {
    setupRenderingTest(hooks, { stubRouter: true });

    hooks.beforeEach(function () {
      this.siteSettings.min_topic_title_length = 5;
      this.siteSettings.max_topic_title_length = 255;
      this.courses = [{ id: "course-a", name: "微观经济学", grade: 1 }];
      this.course = this.courses[0];
      this.grades = [
        { id: 1, label: "大一" },
        { id: 2, label: "大二" },
      ];
      this.onClose = () => {};
      this.onSubmitted = () => {};
    });

    test("ordinary users see the exact WPS link without direct upload controls", async function (assert) {
      this.currentUser.setProperties({
        admin: false,
        academy_moderator_permissions: { manage_resources: false },
      });
      await render(
        <template>
          <LearningManagementDialog @onClose={{this.onClose}} />
        </template>
      );
      assert
        .dom(
          '.isbf-learning-share-dialog a[href="https://f.wps.cn/g/wG6gL3Rz/"]'
        )
        .hasText(
          i18n(themePrefix("isbf_v2.learning_wps_collection")),
          "the collection entry uses the specified text and destination"
        );
      assert
        .dom(".isbf-learning-share-dialog form")
        .doesNotExist("ordinary users cannot directly upload");
    });

    test("a delegated manager selects the student identity before directly publishing", async function (assert) {
      this.currentUser.setProperties({
        admin: false,
        academy_moderator_permissions: { manage_resources: true },
      });
      let saved;
      pretender.get("/isbf/learning/contributor-users", () =>
        response({
          users: [{ id: 77, name: "测试贡献者", username: "contributor" }],
        })
      );
      pretender.post("/isbf/learning/resources", (request) => {
        saved = new URLSearchParams(request.requestBody);
        return response({
          success: true,
          pending: false,
          resource: { id: 21 },
        });
      });
      await render(
        <template>
          <LearningManagementDialog
            @course={{this.course}}
            @courses={{this.courses}}
            @grades={{this.grades}}
            @onClose={{this.onClose}}
            @onSubmitted={{this.onSubmitted}}
          />
        </template>
      );
      await fillIn('input[name="title"]', "Course resource contribution");
      await fillIn('input[name="link"]', "https://example.org/course");
      await fillIn('input[name="student_number"]', "20260001");
      assert
        .dom('button[type="submit"]')
        .isDisabled("a number needs an explicit matching user selection");
      await click(".isbf-learning-share-dialog__find-user");
      await click(".isbf-learning-share-dialog__contributor-user");
      await click('button[type="submit"]');
      assert.strictEqual(
        saved.get("student_number"),
        "20260001",
        "the submitted identity preserves the entered number"
      );
      assert.strictEqual(
        saved.get("contributor_user_id"),
        "77",
        "the selected account is sent independently of the display name"
      );
      assert.strictEqual(
        saved.get("course_id"),
        "course-a",
        "publication retains the selected course"
      );
    });

    test("editing preloads all fields and clearing a student number clears its association", async function (assert) {
      this.currentUser.set("admin", true);
      this.resource = {
        id: 21,
        title: "Existing published resource",
        description: "已有简介",
        links: ["https://example.org/old"],
        contributor: "原贡献者",
        course: this.courses[0],
        student_number: "20260001",
        contributor_user_id: 77,
        files: [],
      };
      pretender.get("/isbf/learning/contributor-users", () =>
        response({ users: [{ id: 77, username: "contributor" }] })
      );
      let saved;
      pretender.put("/isbf/learning/resources/21", (request) => {
        saved = new URLSearchParams(request.requestBody);
        return response({ success: true, pending: false, edited: true });
      });
      await render(
        <template>
          <LearningManagementDialog
            @courses={{this.courses}}
            @grades={{this.grades}}
            @onClose={{this.onClose}}
            @onSubmitted={{this.onSubmitted}}
            @resource={{this.resource}}
          />
        </template>
      );
      assert
        .dom('textarea[name="description"]')
        .hasValue("已有简介", "the introduction is editable");
      await fillIn('input[name="student_number"]', "");
      await fillIn('input[name="title"]', "Updated published resource");
      await click('button[type="submit"]');
      assert.strictEqual(
        saved.get("contributor_user_id"),
        "",
        "clearing the identity removes the explicit attribution"
      );
      assert.strictEqual(
        saved.get("title"),
        "Updated published resource",
        "the edited title is submitted"
      );
      await settled();
    });
  }
);

module(
  "ISBF | Integration | Component | LearningDirectoryEditor",
  function (hooks) {
    setupRenderingTest(hooks, { stubRouter: true });

    test("the parent selector initializes with declarative float options", async function (assert) {
      this.grades = [{ id: 1, label: "大一" }];
      this.onChange = () => {};
      await render(
        <template>
          <ResourceParentPicker
            @grades={{this.grades}}
            @label="年级"
            @onChange={{this.onChange}}
            @value={{1}}
          />
        </template>
      );
      assert.dom(".isbf-learning__grade").hasText("大一");
      assert.dom(".isbf-learning__grade").hasAttribute("aria-label", "年级");
    });

    test("an existing course can be renamed and moved without changing its id", async function (assert) {
      this.entry = { id: "course-a", name: "微观经济学", grade: 1 };
      this.grades = [
        { id: 1, label: "大一" },
        { id: 2, label: "大二" },
      ];
      this.onClose = () => {};
      let saved;
      this.onSaved = () => {};
      pretender.put("/isbf/learning/courses/course-a", (request) => {
        saved = new URLSearchParams(request.requestBody);
        return response({
          success: true,
          pending: false,
          course: { ...this.entry, name: "中级微观经济学" },
        });
      });
      await render(
        <template>
          <LearningDirectoryEditor
            @entry={{this.entry}}
            @grades={{this.grades}}
            @kind="course"
            @onClose={{this.onClose}}
            @onSaved={{this.onSaved}}
          />
        </template>
      );
      await fillIn('input[name="name"]', "中级微观经济学");
      await click('button[type="submit"]');
      assert.strictEqual(
        saved.get("name"),
        "中级微观经济学",
        "the changed course name uses the existing update route"
      );
    });
  }
);
