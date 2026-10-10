import {
  click,
  fillIn,
  find,
  focus,
  render,
  triggerEvent,
  triggerKeyEvent,
} from "@ember/test-helpers";
import { module, test } from "qunit";
import { themePrefix } from "virtual:theme";
import { setupRenderingTest } from "discourse/tests/helpers/component-test";
import pretender, {
  parsePostData,
  response,
} from "discourse/tests/helpers/create-pretender";
import formKit from "discourse/tests/helpers/form-kit-helper";
import { i18n } from "discourse-i18n";
import ISBFV2AccountMenu from "../discourse/components/isbf-v2-account-menu";

const trigger = ".isbf-v2-account-menu__trigger";
const panel = ".isbf-v2-account-menu__panel";
const linkButton = ".isbf-v2-account-menu__link";
const linkForm = ".isbf-v2-account-menu__link-form";
const verifyForm = ".isbf-v2-account-menu__verify";
const emailCode = "123456";
const authenticatorCode = "654321";
const approvedAccount = {
  id: 77,
  status: "approved",
  device_authorized: false,
  account: { username: "second_admin", email_code_enabled: true },
};

module("Integration | Component | ISBFV2AccountMenu", function (hooks) {
  setupRenderingTest(hooks, { stubRouter: true });

  hooks.beforeEach(function () {
    this.currentUser.setProperties({
      admin: true,
      can_switch_linked_accounts: false,
    });
    this.siteSettings.isbf_account_switch_enabled = true;
    this.links = [];
    this.requests = [];
    this.requestError = null;
    this.codeError = null;
    this.listDenied = false;
    pretender.post("/isbf/account-switch/links/77/email-code", () => {
      this.requests.push({ method: "SEND_CODE" });
      return this.codeError
        ? response(429, { errors: [this.codeError] })
        : response({ success: "OK", expires_in: 600 });
    });
    pretender.post("/isbf/account-switch/links/77/verify", (request) => {
      this.requests.push({
        method: "VERIFY",
        data: parsePostData(request.requestBody),
      });
      return response(403, { errors: ["Invalid verification code"] });
    });
    pretender.get("/isbf/account-switch/accounts", () => {
      this.requests.push({ method: "GET" });
      if (this.listDenied) {
        return response(403, { errors: ["Access denied"] });
      }
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

  test("email verification sends a code and keeps the menu open", async function (assert) {
    this.links = [approvedAccount];
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await click(".isbf-v2-account-menu__linked-account > button");
    await formKit(verifyForm).field("verificationMethod").select("email_code");
    await click(".isbf-v2-account-menu__send-code");

    assert.dom(panel).exists("sending a code retains the menu");
    assert
      .dom(`${verifyForm} button[type=submit]`)
      .hasText(
        i18n(themePrefix("isbf_v2.verify_and_switch")),
        "the submit label describes verification and switching"
      );
    assert
      .dom(`${verifyForm} input[type=password]`)
      .doesNotExist("email verification needs no password");
    assert
      .dom(".isbf-v2-account-menu__code-status")
      .includesText("10", "the actual validity period is shown");
    assert.deepEqual(
      this.requests,
      [{ method: "GET" }, { method: "SEND_CODE" }],
      "sending the code does not switch the session"
    );
  });

  test("submitting an email code excludes the password and preserves the draft after an error", async function (assert) {
    this.links = [approvedAccount];
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await click(".isbf-v2-account-menu__linked-account > button");
    await fillIn(`${verifyForm} input[name=password]`, "unused-password");
    await formKit(verifyForm).field("verificationMethod").select("email_code");
    await formKit(verifyForm).field("emailCode").fillIn(emailCode);
    await formKit(verifyForm).submit();

    assert.deepEqual(
      this.requests.at(-1),
      {
        method: "VERIFY",
        data: {
          verification_method: "email_code",
          email_code: "123456",
          second_factor_method: "1",
        },
      },
      "only the selected primary credential is sent"
    );
    assert
      .dom(".isbf-v2-account-menu__error")
      .hasText("Invalid verification code", "the server's error is shown");
    assert
      .form(verifyForm)
      .field("emailCode")
      .hasValue("123456", "the draft remains available for correction");
  });

  test("a failed code request exposes the error without showing a delivery confirmation", async function (assert) {
    this.links = [approvedAccount];
    this.codeError = "Wait before requesting another code";
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await click(".isbf-v2-account-menu__linked-account > button");
    await formKit(verifyForm).field("verificationMethod").select("email_code");
    await click(".isbf-v2-account-menu__send-code");

    assert
      .dom(".isbf-v2-account-menu__error")
      .hasText(this.codeError, "the send failure is visible");
    assert
      .dom(".isbf-v2-account-menu__code-status")
      .doesNotExist("delivery is not claimed after a failure");
    assert.dom(panel).exists("the user can retry from the same menu");
  });

  test("email verification retains the target's second factor", async function (assert) {
    this.links = [
      {
        ...approvedAccount,
        account: { ...approvedAccount.account, totp_enabled: true },
      },
    ];
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await click(".isbf-v2-account-menu__linked-account > button");
    const descriptionId = find(
      `${verifyForm} [name=secondFactorToken]`
    ).getAttribute("aria-describedby");
    assert
      .dom(`#${descriptionId}`)
      .hasText(i18n(themePrefix("isbf_v2.authenticator_code_help")));
    await formKit(verifyForm).field("verificationMethod").select("email_code");
    await formKit(verifyForm).field("emailCode").fillIn(emailCode);
    await formKit(verifyForm)
      .field("secondFactorToken")
      .fillIn(authenticatorCode);
    await formKit(verifyForm).submit();

    assert.deepEqual(
      this.requests.at(-1).data,
      {
        verification_method: "email_code",
        email_code: "123456",
        second_factor_method: "1",
        second_factor_token: "654321",
      },
      "both factors reach the server"
    );
  });

  test("the second-factor source follows the selected authenticator or backup code", async function (assert) {
    this.links = [
      {
        ...approvedAccount,
        account: {
          ...approvedAccount.account,
          totp_enabled: true,
          backup_codes_enabled: true,
        },
      },
    ];
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await click(".isbf-v2-account-menu__linked-account > button");
    const descriptionId = find(
      `${verifyForm} [name=secondFactorToken]`
    ).getAttribute("aria-describedby");
    assert
      .dom(`#${descriptionId}`)
      .hasText(i18n(themePrefix("isbf_v2.authenticator_code_help")));

    await formKit(verifyForm).field("secondFactorMethod").select("2");
    assert
      .dom(`#${descriptionId}`)
      .hasText(i18n(themePrefix("isbf_v2.backup_code_help")));
    await formKit(verifyForm).field("secondFactorMethod").select("1");
    assert
      .dom(`#${descriptionId}`)
      .hasText(i18n(themePrefix("isbf_v2.authenticator_code_help")));
  });

  test("the password alternative keeps its existing second-factor payload", async function (assert) {
    this.links = [approvedAccount];
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await click(".isbf-v2-account-menu__linked-account > button");
    assert
      .dom(`${verifyForm} [name=secondFactorToken]`)
      .doesNotExist(
        "accounts without two-factor authentication need no extra code"
      );
    await fillIn(`${verifyForm} input[name=password]`, "target-password");
    await formKit(verifyForm).submit();

    assert.deepEqual(
      this.requests.at(-1).data,
      {
        verification_method: "password",
        password: "target-password",
        second_factor_method: "1",
      },
      "password verification stays available"
    );
    assert
      .dom(".isbf-v2-account-menu__send-code")
      .doesNotExist("a code is only sent from the email alternative");
  });

  for (const [role, admin, moderator] of [
    ["member", false, false],
    ["moderator", false, true],
  ]) {
    for (const mobile of [true, false]) {
      test(`an approved ${role} can open linked accounts in ${mobile ? "mobile" : "desktop"} navigation without a creation form`, async function (assert) {
        this.currentUser.setProperties({
          admin,
          moderator,
          can_switch_linked_accounts: true,
        });
        this.links = [{ ...approvedAccount, device_authorized: true }];
        this.set("mobile", mobile);
        await render(
          <template><ISBFV2AccountMenu @mobile={{this.mobile}} /></template>
        );
        await click(trigger);

        assert.dom(linkButton).exists("the approved account has an entry");
        assert
          .dom(".isbf-v2-account-menu__linked-account")
          .doesNotExist("the accounts wait for the entry to be opened");
        await click(linkButton);

        assert
          .dom(linkButton)
          .hasAttribute(
            "aria-expanded",
            "true",
            "the expanded section is announced"
          );
        assert
          .dom(".isbf-v2-account-menu__linked-account")
          .includesText(
            "@second_admin",
            "the approved counterpart is displayed"
          );
        assert
          .dom(".isbf-v2-account-menu__linked-account > button")
          .hasText(
            i18n(themePrefix("isbf_v2.switch_now")),
            "the device can switch immediately"
          );
        assert
          .dom(linkForm)
          .doesNotExist("only administrators can create another link");
        assert.deepEqual(
          this.requests,
          [{ method: "GET" }],
          "opening linked accounts only reads the list"
        );
      });

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

  test("an approved member can verify an email code on a new device", async function (assert) {
    this.currentUser.setProperties({
      admin: false,
      can_switch_linked_accounts: true,
    });
    this.links = [approvedAccount];
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);
    await click(linkButton);
    await click(".isbf-v2-account-menu__linked-account > button");
    await formKit(verifyForm).field("verificationMethod").select("email_code");
    await click(".isbf-v2-account-menu__send-code");

    assert
      .dom(".isbf-v2-account-menu__code-status")
      .exists("delivery is confirmed for the approved participant");
    assert
      .dom(linkForm)
      .doesNotExist("verification cannot open account creation");
    await formKit(verifyForm).field("emailCode").fillIn(emailCode);
    await formKit(verifyForm).submit();
    assert.strictEqual(
      this.requests.at(-1).method,
      "VERIFY",
      "the existing device verification endpoint is used"
    );
    assert.strictEqual(
      this.requests.at(-1).data.email_code,
      emailCode,
      "the target code reaches verification"
    );
  });

  test("a revoked member loses its entry when the server rejects the account list", async function (assert) {
    this.currentUser.setProperties({
      admin: false,
      can_switch_linked_accounts: true,
    });
    this.listDenied = true;
    await render(<template><ISBFV2AccountMenu @mobile={{true}} /></template>);
    await click(trigger);

    assert
      .dom(linkButton)
      .doesNotExist("the stale entry is removed after permission loss");
    assert
      .dom(".isbf-v2-account-menu__linked-account")
      .doesNotExist("there are no stale switching controls");
  });

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
