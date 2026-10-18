import { click, fillIn, render, settled } from "@ember/test-helpers";
import { module, test } from "qunit";
import { themePrefix } from "virtual:theme";
import { setupRenderingTest } from "discourse/tests/helpers/component-test";
import pretender, { response } from "discourse/tests/helpers/create-pretender";
import { i18n } from "discourse-i18n";
import LearningDirectoryDeletion from "../../discourse/components/isbf-learning-directory-deletion";
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
          users: [
            {
              id: 77,
              name: "测试贡献者",
              username: "contributor",
              avatar_template: "/user_avatar/test/contributor/{size}/1.png",
            },
          ],
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
      assert
        .dom(".isbf-learning-share-dialog__contributor-user img.avatar")
        .exists("the matching account includes its avatar");
      assert
        .dom(".isbf-learning-share-dialog__contributor-user")
        .includesText("@contributor");
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
  "ISBF | Integration | Component | LearningDirectoryDeletion",
  function (hooks) {
    setupRenderingTest(hooks, { stubRouter: true });

    hooks.beforeEach(function () {
      this.currentUser.set("admin", true);
      this.entry = { id: "course-a", name: "课程" };
      this.kind = "course";
      this.onClose = () => {};
      this.onDeleted = () => {};
      this.plan = {
        name: "课程",
        required_confirmations: 3,
        course_count: 1,
        resource_count: 2,
        has_children: true,
        confirmation_token: "signed-plan",
      };
      pretender.get("/isbf/learning/courses/course-a/deletion-plan", () =>
        response(this.plan)
      );
    });

    async function show(context) {
      await render(
        <template>
          <LearningDirectoryDeletion
            @entry={{context.entry}}
            @kind={{context.kind}}
            @onClose={{context.onClose}}
            @onDeleted={{context.onDeleted}}
          />
        </template>
      );
    }

    for (const [kind, count] of [
      ["course", 3],
      ["grade", 3],
      ["course", 2],
      ["grade", 2],
    ]) {
      test(`${kind} sends deletion only after ${count} confirmations`, async function (assert) {
        this.kind = kind;
        this.plan.required_confirmations = count;
        this.plan.has_children = count === 3;
        const path = `/isbf/learning/${kind === "grade" ? "grades" : "courses"}/course-a`;
        pretender.get(`${path}/deletion-plan`, () => response(this.plan));
        let deleted = 0;
        pretender.delete(path, (request) => {
          deleted++;
          assert.strictEqual(
            new URLSearchParams(request.requestBody).get("confirmation_count"),
            String(count)
          );
          return response({ success: true });
        });
        await show(this);
        for (let step = 1; step < count; step++) {
          assert.strictEqual(
            deleted,
            0,
            "confirmation alone never deletes early"
          );
          await click(".isbf-learning-directory-deletion__confirm");
        }
        if (count === 3) {
          assert
            .dom("strong.isbf-learning-directory-deletion__warning")
            .hasText(
              i18n(themePrefix(`isbf_v2.learning_delete_${kind}_warning`))
            );
        }
        await click(".isbf-learning-directory-deletion__confirm");
        assert.strictEqual(deleted, 1);
      });
    }

    for (const step of [1, 2, 3]) {
      test(`Back cancels the whole deletion at step ${step}`, async function (assert) {
        let closed = 0;
        let deleted = 0;
        this.onClose = () => closed++;
        pretender.delete("/isbf/learning/courses/course-a", () => {
          deleted++;
          return response({ success: true });
        });
        await show(this);
        for (let current = 1; current < step; current++) {
          await click(".isbf-learning-directory-deletion__confirm");
        }
        await click(".isbf-learning-directory-deletion__actions .btn");
        assert.strictEqual(closed, 1);
        assert.strictEqual(deleted, 0);
      });
    }

    test("stale content restarts confirmations and revoked permission prevents deletion", async function (assert) {
      let deleted = 0;
      pretender.delete("/isbf/learning/courses/course-a", () => {
        deleted++;
        return response({ errors: ["Content changed"] }, 409);
      });
      await show(this);
      for (let current = 0; current < 3; current++) {
        await click(".isbf-learning-directory-deletion__confirm");
      }
      assert.dom("[role=alert]").hasText("Content changed");
      assert
        .dom("strong.isbf-learning-directory-deletion__warning")
        .doesNotExist("a stale plan must be reconfirmed from step one");
      this.currentUser.setProperties({
        admin: false,
        academy_moderator_permissions: { manage_resources: false },
      });
      await settled();
      assert.dom(".isbf-learning-directory-deletion__confirm").isDisabled();
      assert.strictEqual(deleted, 1);
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
