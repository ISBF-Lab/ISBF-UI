import { waitUntil } from "@ember/test-helpers";
import { module, test } from "qunit";
import sinon from "sinon";
import ProfileNavigation from "../discourse/lib/profile-navigation";

function visibleRect(indicator) {
  const box = indicator.getBoundingClientRect();
  const style = getComputedStyle(indicator);
  const values = style.clipPath
    .match(/^inset\((.*?)\s+round\s/)[1]
    .split(/\s+/)
    .map(Number.parseFloat);
  const [top, right = top, bottom = top, left = right] = values;
  const scaleX = box.width / Number.parseFloat(style.width);
  const scaleY = box.height / Number.parseFloat(style.height);
  return new DOMRect(
    box.x + left * scaleX,
    box.y + top * scaleY,
    box.width - (left + right) * scaleX,
    box.height - (top + bottom) * scaleY
  );
}

module("Unit | Lib | profile-navigation", function (hooks) {
  hooks.beforeEach(function () {
    this.motion = new EventTarget();
    this.motion.matches = false;
    sinon.stub(window, "matchMedia").returns(this.motion);
    this.element = document.createElement("div");
    this.element.id = "profile-navigation-test-fixture";
    this.element.className = "user-navigation user-navigation-secondary";
    Object.assign(this.element.style, {
      position: "absolute",
      left: "-10000px",
      width: "640px",
    });
    this.element.style.setProperty("--isbf-v2-radius-pill", "999px");
    const controls = document.createElement("div");
    controls.className = "d-overflow-controls";
    controls.style.position = "relative";
    const list = document.createElement("ul");
    list.className = "nav-pills action-list";
    Object.assign(list.style, {
      display: "flex",
      gap: "4px",
      boxSizing: "border-box",
      margin: "0",
      padding: "4px",
    });
    // Theme QUnit omits theme CSS; establish the decorative layers before measuring.
    const style = document.createElement("style");
    style.textContent = `
      #profile-navigation-test-fixture .isbf-profile-nav__indicator,
      #profile-navigation-test-fixture .isbf-profile-nav__fill {
        position: absolute;
        inset: 0;
        display: block;
      }
    `;
    this.element.append(style);
    this.links = [
      ["All", "/u/reviewer/activity"],
      ["Topics with a longer label", "/u/reviewer/activity/topics"],
      ["Private", "/u/reviewer/activity/private"],
    ].map(([label, href], index) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.textContent = label;
      link.href = href;
      Object.assign(link.style, {
        display: "inline-flex",
        alignItems: "center",
        boxSizing: "border-box",
        height: "44px",
        minWidth: "60px",
        padding: "0 12px",
        borderRadius: "999px",
        whiteSpace: "nowrap",
      });
      item.hidden = index === 2;
      item.append(link);
      list.append(item);
      return link;
    });
    this.select = (index) => {
      this.links.forEach((link, current) => {
        link.classList.toggle("active", current === index);
      });
    };
    this.select(0);
    controls.append(list);
    this.element.append(controls);
    document.body.append(this.element);
    this.enhance = () => {
      this.navigation = new ProfileNavigation(this.element);
      this.indicator = this.element.querySelector(
        ".isbf-profile-nav__indicator"
      );
    };
    this.enhance();
  });

  hooks.afterEach(function () {
    this.navigation?.destroy();
    this.element.remove();
    sinon.restore();
  });

  test("enhancement keeps native routes, labels, and hidden flags", function (assert) {
    assert
      .dom(this.links[0])
      .hasAttribute(
        "href",
        "/u/reviewer/activity",
        "native routes remain links"
      );
    assert.dom(this.links[0]).hasText("All", "the native label stays intact");
    assert
      .dom(this.links[2].parentElement)
      .hasAttribute("hidden", "", "permission visibility stays intact");
    assert
      .dom(this.indicator)
      .hasAttribute("aria-hidden", "true", "the capsule is decorative");

    this.navigation.destroy();
    this.navigation = null;
    assert.false(
      this.indicator.isConnected,
      "destroy removes the decorative layer"
    );
    assert.false(
      this.element.classList.contains("isbf-profile-navigation"),
      "destroy removes the enhancement class"
    );
    assert
      .dom(this.links[0])
      .hasAttribute(
        "href",
        "/u/reviewer/activity",
        "destroy keeps native navigation"
      );
  });

  test("the capsule follows route selection with different label widths", async function (assert) {
    const animate = sinon.spy(this.indicator, "animate");
    this.select(1);
    await waitUntil(() => animate.called);
    await waitUntil(() => this.indicator.getAnimations().length === 0);
    const selected = this.links[1].getBoundingClientRect();
    const capsule = visibleRect(this.indicator);

    assert.strictEqual(
      animate.callCount,
      1,
      "one route change starts one motion"
    );
    assert.true(
      Math.abs(selected.x - capsule.x) < 1,
      "the capsule lands on the selected link"
    );
    assert.true(
      Math.abs(selected.width - capsule.width) < 1,
      "the capsule adopts the label width"
    );
    assert.dom(this.links[1]).hasClass("active", "selection remains native");
  });

  test("the leading edge stretches before the trailing edge follows", async function (assert) {
    const original = this.links[0].getBoundingClientRect();
    this.select(1);
    await waitUntil(() => this.indicator.getAnimations().length > 0);
    const animation = this.indicator.getAnimations()[0];
    animation.pause();
    animation.currentTime = 125;
    const selected = this.links[1].getBoundingClientRect();
    const stretched = visibleRect(this.indicator);

    assert.true(
      Math.abs(stretched.x - original.x) < 1,
      "the trailing edge stays by the previous link during the stretch"
    );
    assert.true(
      Math.abs(stretched.right - selected.right) < 1,
      "the leading edge reaches the next link first"
    );
    assert.true(
      stretched.width > Math.max(original.width, selected.width),
      "the capsule bridges both links before contracting"
    );
    animation.finish();
  });

  test("the trailing edge relaxes after landing", async function (assert) {
    this.select(1);
    await waitUntil(() => this.indicator.getAnimations().length > 0);
    const animation = this.indicator.getAnimations()[0];
    animation.pause();
    animation.currentTime = 375;
    const selected = this.links[1].getBoundingClientRect();
    const compressed = visibleRect(this.indicator);

    assert.true(
      compressed.width < selected.width,
      "the capsule compresses briefly on arrival"
    );
    assert.true(
      Math.abs(selected.width - compressed.width - 3) < 0.1,
      "arrival compression uses the requested three pixels"
    );
    animation.finish();
    const relaxed = visibleRect(this.indicator);
    assert.true(
      Math.abs(selected.width - relaxed.width) < 1,
      "the capsule recovers the complete selected width"
    );
  });

  test("the stretch follows the physical direction in RTL", async function (assert) {
    this.navigation.destroy();
    this.element.dir = "rtl";
    this.enhance();
    const original = this.links[0].getBoundingClientRect();
    this.select(1);
    await waitUntil(() => this.indicator.getAnimations().length > 0);
    const animation = this.indicator.getAnimations()[0];
    animation.pause();
    animation.currentTime = 125;
    const selected = this.links[1].getBoundingClientRect();
    const stretched = visibleRect(this.indicator);

    assert.true(selected.x < original.x, "the next RTL link sits to the left");
    assert.true(
      Math.abs(stretched.x - selected.x) < 1,
      "the leading edge stretches left toward the next link"
    );
    assert.true(
      Math.abs(stretched.right - original.right) < 1,
      "the trailing edge stays beside the previous link"
    );
    animation.finish();
  });

  test("a new route interrupts the current animation", async function (assert) {
    const animate = sinon.spy(this.indicator, "animate");
    this.select(1);
    await waitUntil(() => animate.calledOnce);
    const first = animate.firstCall.returnValue;
    first.pause();
    first.currentTime = 100;
    const interrupted = visibleRect(this.indicator);
    this.select(0);
    await waitUntil(() => animate.calledTwice);
    const second = animate.secondCall.returnValue;
    second.pause();
    second.currentTime = 0;
    const continued = visibleRect(this.indicator);

    assert.strictEqual(
      first.playState,
      "idle",
      "the previous animation is cancelled"
    );
    assert.true(
      Math.abs(interrupted.x - continued.x) < 1,
      "an interruption starts from the current visual edge"
    );
    assert.true(
      Math.abs(interrupted.width - continued.width) < 1,
      "an interruption keeps the current visual stretch"
    );
    assert
      .dom(this.links[0])
      .hasClass("active", "the latest route remains selected");
  });

  test("reduced motion moves immediately without starting an animation", async function (assert) {
    this.motion.matches = true;
    const animate = sinon.spy(Element.prototype, "animate");
    const previous = this.indicator.style.clipPath;
    this.select(1);
    await waitUntil(() => this.indicator.style.clipPath !== previous);

    assert.false(
      animate.called,
      "reduced motion does not start an elastic animation"
    );
    assert
      .dom(this.links[1])
      .hasClass("active", "the native route still changes");
  });

  test("stretching preserves height and circular end caps throughout the motion", async function (assert) {
    const height = this.links[0].getBoundingClientRect().height;
    this.select(1);
    await waitUntil(() => this.indicator.getAnimations().length > 0);
    const animation = this.indicator.getAnimations()[0];
    animation.pause();
    for (const time of [0, 60, 125, 250, 375, 450, 508]) {
      animation.currentTime = time;
      const shape = visibleRect(this.indicator);
      const style = getComputedStyle(this.indicator);
      const radius = Number.parseFloat(
        style.clipPath.match(/round\s+([\d.]+)/)[1]
      );
      assert.strictEqual(
        style.transform,
        "none",
        `the capsule is never scaled at ${time}ms`
      );
      assert.true(
        Math.abs(shape.height - height) < 0.01,
        `height stays unchanged at ${time}ms`
      );
      assert.true(
        Math.abs(radius * 2 - height) < 0.01,
        `the end cap remains circular at ${time}ms`
      );
    }
    animation.finish();
  });

  test("resizing during a stretch cancels it and remeasures the clip canvas", async function (assert) {
    this.select(1);
    await waitUntil(() => this.indicator.getAnimations().length > 0);
    const animation = this.indicator.getAnimations()[0];
    animation.pause();
    animation.currentTime = 100;
    this.element.style.width = "400px";
    await waitUntil(() => animation.playState === "idle");
    const selected = this.links[1].getBoundingClientRect();
    const shape = visibleRect(this.indicator);
    assert.true(
      Math.abs(shape.x - selected.x) < 1,
      "the capsule aligns after the canvas changes"
    );
    assert.true(
      Math.abs(shape.width - selected.width) < 1,
      "resizing preserves the selected width"
    );
    assert.strictEqual(
      this.indicator.getAnimations({ subtree: true }).length,
      0,
      "resizing cancels both decorative layers"
    );
  });

  test("native square link styles do not flatten the capsule", async function (assert) {
    this.links.forEach((link) => {
      link.style.borderRadius = "0";
    });
    this.select(1);
    await waitUntil(() => this.indicator.getAnimations().length > 0);
    const animation = this.indicator.getAnimations()[0];
    animation.pause();
    animation.currentTime = 125;
    const shape = visibleRect(this.indicator);
    const radius = Number.parseFloat(
      getComputedStyle(this.indicator).clipPath.match(/round\s+([\d.]+)/)[1]
    );
    assert.true(
      Math.abs(radius * 2 - shape.height) < 0.01,
      "the original pill token controls the end cap independently of Core link styles"
    );
    animation.finish();
  });

  test("enabling reduced motion stops an existing stretch immediately", async function (assert) {
    this.select(1);
    await waitUntil(() => this.indicator.getAnimations().length > 0);
    const animation = this.indicator.getAnimations()[0];
    animation.pause();
    animation.currentTime = 100;
    this.motion.matches = true;
    this.motion.dispatchEvent(new Event("change"));
    await waitUntil(() => animation.playState === "idle");
    const selected = this.links[1].getBoundingClientRect();
    const shape = visibleRect(this.indicator);
    assert.true(
      Math.abs(shape.x - selected.x) < 1,
      "reduced motion immediately aligns the capsule"
    );
    assert.true(
      Math.abs(shape.width - selected.width) < 1,
      "reduced motion immediately adopts the selected width"
    );
    assert.strictEqual(
      this.indicator.getAnimations({ subtree: true }).length,
      0,
      "both decorative animations stop"
    );
  });
});
