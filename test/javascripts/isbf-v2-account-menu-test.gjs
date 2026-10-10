import {
  click,
  fillIn,
  focus,
  render,
  triggerEvent,
  triggerKeyEvent,
} from "@ember/test-helpers";
import { module, test } from "qunit";
import { setupRenderingTest } from "discourse/tests/helpers/component-test";
import pretender, {
  parsePostData,
  response,
} from "discourse/tests/helpers/create-pretender";
import ISBFV2AccountMenu from "../discourse/components/isbf-v2-account-menu";

const trigger = ".isbf-v2-account-menu__trigger";
const panel = ".isbf-v2-account-menu__panel";
const linkButton = ".isbf-v2-account-menu__link";
const linkForm = ".isbf-v2-account-menu__link-form";

module("Integration | Component | ISBFV2AccountMenu", function (hooks) {
  setupRenderingTest(hooks, { stubRouter: true });

  hooks.beforeEach(function () {
    this.currentUser.set("admin", true);
    this.siteSettings.isbf_account_switch_enabled = true;
    this.links = [];
    this.requests = [];
    this.requestError = null;
    pretender.get("/isbf/account-switch/accounts", () => {
      this.requests.push({ method: "GET" });
      return response({ links: this.links });
    });
    pretender.post("/isbf/account-switch/links", (request) => {
      const data = parsePostData(request.requestBody);
      this.requests.push({ method: "POST", data });
      if (this.requestError) {
        return response(422, { errors: [this.requestError] });
      }
      const link = {
        id: 1,
        status: "pending_admin",
        account: { username: data.username },
      };
      this.links = [link];
      return response({ link });
    });
  });

  test("an administrator can open the mobile form without removing its focused trigger", async function (assert) {
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await focus(linkButton);
    await click(linkButton);

    assert.dom(panel).exists("the account menu stays open");
    assert.dom(linkForm).exists("the username form is available");
    assert
      .dom(linkButton)
      .isFocused("the clicked control survives the form transition");
    assert
      .dom(linkButton)
      .hasAttribute("aria-expanded", "true", "the form state is announced");
  });

  test("an administrator can submit a username and see the pending link", async function (assert) {
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await click(linkButton);
    await fillIn(`${linkForm} input`, "  second_admin  ");
    await triggerEvent(linkForm, "submit");

    assert.deepEqual(
      this.requests.filter((request) => request.method === "POST"),
      [{ method: "POST", data: { username: "second_admin" } }],
      "the trimmed username reaches the account-link API"
    );
    assert.dom(panel).exists("the menu remains open after submitting");
    assert.dom(linkForm).doesNotExist("the completed form closes");
    assert
      .dom(".isbf-v2-account-menu__linked-account")
      .includesText("@second_admin", "the pending account is displayed");
    assert
      .dom(linkButton)
      .hasAttribute("aria-expanded", "false", "another request can be opened");
  });

  test("a failed request keeps the username form and shows the server error", async function (assert) {
    this.requestError = "This account cannot be linked";
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await click(linkButton);
    await fillIn(`${linkForm} input`, "unknown_user");
    await triggerEvent(linkForm, "submit");

    assert.dom(linkForm).exists("the user can correct the request");
    assert
      .dom(`${linkForm} input`)
      .hasValue("unknown_user", "the entered username is retained");
    assert
      .dom(".isbf-v2-account-menu__error")
      .hasText(this.requestError, "the actual API error is visible");
  });

  test("losing focus without a destination keeps an unfinished form", async function (assert) {
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await click(linkButton);
    await fillIn(`${linkForm} input`, "second_admin");
    await triggerEvent(`${linkForm} input`, "focusout", {
      relatedTarget: null,
    });

    assert.dom(panel).exists("the menu survives a control losing focus");
    assert
      .dom(`${linkForm} input`)
      .hasValue("second_admin", "the unfinished request is preserved");
  });

  test("tabbing outside closes the desktop menu", async function (assert) {
    await render(
      <template>
        <ISBFV2AccountMenu />
        <button class="outside-account-menu" type="button">Outside</button>
      </template>
    );
    await focus(trigger);
    await click(linkButton);
    await focus(`${linkForm} input`);
    await focus(".outside-account-menu");

    assert.dom(panel).doesNotExist("focus leaving the menu closes it");
  });

  test("Escape closes the mobile form and restores focus to the account trigger", async function (assert) {
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await click(linkButton);
    await focus(`${linkForm} input`);
    await triggerKeyEvent(`${linkForm} input`, "keydown", "Escape");

    assert.dom(panel).doesNotExist("Escape closes the menu");
    assert.dom(trigger).isFocused("focus returns to the trigger");
  });

  test("an approved account opens credential verification on a new device", async function (assert) {
    this.links = [
      {
        id: 1,
        status: "approved",
        device_authorized: false,
        account: { username: "second_admin", totp_enabled: true },
      },
    ];
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await click(".isbf-v2-account-menu__linked-account > button");

    assert
      .dom('.isbf-v2-account-menu__verify input[type="password"]')
      .exists("the target password is required before switching");
    assert
      .dom('.isbf-v2-account-menu__verify input[autocomplete="one-time-code"]')
      .exists("the target's second factor remains available");
    assert.deepEqual(
      this.requests,
      [{ method: "GET" }],
      "selecting verification does not switch the session"
    );
  });

  for (const [role, admin, moderator] of [
    ["member", false, false],
    ["moderator", false, true],
  ]) {
    for (const mobile of [true, false]) {
      test(`${role} has no account-link entry in ${mobile ? "mobile" : "desktop"} navigation`, async function (assert) {
        this.currentUser.setProperties({ admin, moderator });
        this.set("mobile", mobile);
        await render(
          <template><ISBFV2AccountMenu @mobile={{this.mobile}} /></template>
        );
        await click(trigger);

        assert.dom(panel).exists("the ordinary account menu remains available");
        assert.dom(linkButton).doesNotExist("the restricted entry is hidden");
        assert.dom(linkForm).doesNotExist("the restricted form is absent");
        assert
          .dom(".isbf-v2-account-menu__linked-account")
          .doesNotExist("linked-account controls are hidden");
        assert.deepEqual(
          this.requests,
          [],
          "opening the menu makes no restricted API request"
        );
      });
    }
  }

  test("a disabled feature hides the entry for an administrator", async function (assert) {
    this.siteSettings.isbf_account_switch_enabled = false;
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);

    assert.dom(linkButton).doesNotExist("the disabled feature has no entry");
    assert
      .dom(".isbf-v2-account-menu__error")
      .doesNotExist("the ordinary menu has no plugin error");
    assert.deepEqual(this.requests, [], "no disabled-feature request is sent");
  });
});

module(
  "Integration | Component | ISBFV2AccountMenu | Anonymous",
  function (hooks) {
    setupRenderingTest(hooks, { anonymous: true, stubRouter: true });

    test("a visitor has no account menu", async function (assert) {
      await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
      assert
        .dom(".isbf-v2-account-menu")
        .doesNotExist("account controls require a signed-in user");
    });
  }
);
