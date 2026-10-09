import { render, settled } from "@ember/test-helpers";
import { module, test } from "qunit";
import { settings } from "virtual:theme";
import { setupRenderingTest } from "discourse/tests/helpers/component-test";
// Theme tests resolve imports from the compiled test directory.
import ISBFV2Brand from "../discourse/components/isbf-v2-brand";

const main = "/images/d-logo-sketch.png?main";
const small = "/images/d-logo-sketch-small.png?small";
const mobile = "/images/d-logo-sketch.png?mobile";
const mainDark = "/images/d-logo-sketch.png?main-dark";
const smallDark = "/images/d-logo-sketch-small.png?small-dark";
const mobileDark = "/images/d-logo-sketch.png?mobile-dark";

module("Integration | Component | ISBFV2Brand", function (hooks) {
  setupRenderingTest(hooks, { stubRouter: true });

  hooks.beforeEach(function () {
    Object.assign(this.siteSettings, {
      site_logo_url: main,
      site_logo_small_url: small,
      site_mobile_logo_url: mobile,
      site_logo_dark_url: mainDark,
      site_logo_small_dark_url: smallDark,
      site_mobile_logo_dark_url: mobileDark,
    });
    this.session.set("darkModeAvailable", false);
    this.session.set("defaultColorSchemeIsDark", false);
    this.interfaceColor = this.owner.lookup("service:interface-color");
    this.interfaceColor.useAutoMode({ adjustStylesheets: false });
  });

  hooks.afterEach(function () {
    this.interfaceColor.useAutoMode({ adjustStylesheets: false });
    this.session.set("darkModeAvailable", null);
    this.session.set("defaultColorSchemeIsDark", null);
  });

  test("full navigation uses the main logo and native home link", async function (assert) {
    await render(<template><ISBFV2Brand @compact={{false}} /></template>);
    assert
      .dom(".isbf-v2-brand__logo")
      .hasAttribute("src", main, "uses the main logo");
    assert
      .dom(".isbf-v2-brand")
      .hasAttribute("href", "/", "uses the native home link");
    assert
      .dom("#site-logo")
      .doesNotExist("does not duplicate the native header logo ID");
    assert
      .dom(".isbf-v2-brand__logo")
      .doesNotHaveAttribute(
        "width",
        "does not squeeze a wordmark into a square"
      );
  });

  test("compact navigation uses the small logo", async function (assert) {
    await render(<template><ISBFV2Brand @compact={{true}} /></template>);
    assert
      .dom(".isbf-v2-brand__logo")
      .hasAttribute("src", small, "uses the small logo");
  });

  test("mobile navigation uses the mobile logo", async function (assert) {
    await render(<template><ISBFV2Brand @mobile={{true}} /></template>);
    assert
      .dom(".isbf-v2-brand__logo")
      .hasAttribute("src", mobile, "uses the mobile logo");
  });

  test("a missing small logo falls back to the main logo", async function (assert) {
    this.siteSettings.site_logo_small_url = "";
    await render(<template><ISBFV2Brand @compact={{true}} /></template>);
    assert
      .dom(".isbf-v2-brand__logo")
      .hasAttribute("src", main, "uses the main fallback");
  });

  test("a missing mobile logo falls back to the main logo", async function (assert) {
    this.siteSettings.site_mobile_logo_url = "";
    await render(<template><ISBFV2Brand @mobile={{true}} /></template>);
    assert
      .dom(".isbf-v2-brand__logo")
      .hasAttribute("src", main, "uses the main fallback");
  });

  for (const [label, args, light, dark] of [
    ["main", { compact: false }, main, mainDark],
    ["small", { compact: true }, small, smallDark],
    ["mobile", { mobile: true }, mobile, mobileDark],
  ]) {
    test(`${label} logo supplies its own dark alternative`, async function (assert) {
      this.args = args;
      this.session.set("darkModeAvailable", true);
      await render(
        <template>
          <ISBFV2Brand @compact={{@compact}} @mobile={{@mobile}} />
        </template>
      );
      assert
        .dom(".isbf-v2-brand__logo")
        .hasAttribute("src", light, "keeps the light source");
      assert
        .dom(".isbf-v2-brand source")
        .hasAttribute("srcset", dark, "uses the matching dark variant");
      assert
        .dom(".isbf-v2-brand source")
        .hasAttribute(
          "media",
          "(prefers-color-scheme: dark)",
          "follows the native system preference"
        );
    });
  }

  test("a dark default palette uses the dark logo without system dark mode", async function (assert) {
    this.session.set("defaultColorSchemeIsDark", true);
    await render(<template><ISBFV2Brand @compact={{false}} /></template>);
    assert
      .dom(".isbf-v2-brand__logo")
      .hasAttribute("src", mainDark, "uses the default dark palette logo");
    assert
      .dom(".isbf-v2-brand source")
      .doesNotExist("does not add an identical alternative");
  });

  for (const [mode, media] of [
    ["Dark", "all"],
    ["Light", "none"],
  ]) {
    test(`a user can force ${mode.toLowerCase()} logos independently of the system`, async function (assert) {
      this.session.set("darkModeAvailable", true);
      await render(<template><ISBFV2Brand @compact={{false}} /></template>);
      this.interfaceColor[`force${mode}Mode`]({ flipStylesheets: false });
      await settled();
      assert
        .dom(".isbf-v2-brand source")
        .hasAttribute("media", media, "follows the user's explicit preference");
    });
  }

  test("a missing dark variant keeps its ordinary logo", async function (assert) {
    this.session.set("defaultColorSchemeIsDark", true);
    this.siteSettings.site_mobile_logo_dark_url = "";
    await render(<template><ISBFV2Brand @mobile={{true}} /></template>);
    assert
      .dom(".isbf-v2-brand__logo")
      .hasAttribute("src", mobile, "keeps the mobile logo");
  });

  test("no image uses an accessible text fallback", async function (assert) {
    this.siteSettings.site_logo_url = "";
    await render(<template><ISBFV2Brand @compact={{false}} /></template>);
    assert
      .dom(".isbf-v2-brand__logo")
      .doesNotExist("does not render a broken image");
    assert
      .dom(".isbf-v2-brand__name")
      .hasText(settings.brand_name, "shows the configured brand name");
    assert
      .dom(".isbf-v2-brand")
      .hasAttribute("aria-label", settings.brand_name, "labels the home link");
  });
});
