import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const observers = new Set();
const timers = new Map();
let timerId = 0;
let mutationQueued = false;
const mutate = () => {
  if (!mutationQueued) {
    mutationQueued = true;
    queueMicrotask(() => {
      mutationQueued = false;
      for (const observer of [...observers]) {
        observer.callback();
      }
    });
  }
};
const flush = async () => {
  for (let index = 0; index < 12; index++) {
    await Promise.resolve();
  }
};
class Element {
  constructor(tag, doc) {
    this.tagName = tag.toLowerCase();
    this.ownerDocument = doc;
    this.children = [];
    this.attributes = new Map();
    this.listeners = [];
    this.parentElement = null;
    this.focusCalls = [];
    this.classList = {
      add: (name) => {
        this.className = `${this.className} ${name}`.trim();
      },
    };
  }

  get className() {
    return this.getAttribute("class") || "";
  }

  set className(value) {
    this.setAttribute("class", value);
  }

  get href() {
    const value = this.getAttribute("href");
    return value ? new URL(value, "https://forum.example").href : "";
  }

  set href(value) {
    this.setAttribute("href", value);
  }

  get alt() {
    return this.getAttribute("alt") || "";
  }

  get dataset() {
    return Object.fromEntries(
      [...this.attributes]
        .filter(([name]) => name.startsWith("data-"))
        .map(([name, value]) => [
          name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()),
          value,
        ]),
    );
  }

  get isConnected() {
    return (
      this === this.ownerDocument.body ||
      Boolean(this.parentElement?.isConnected)
    );
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  matches(selector) {
    return selector.split(",").some((part) => {
      part = part.trim();
      if (part.startsWith(".")) {
        return this.className.split(/\s+/).includes(part.slice(1));
      }
      if (part.startsWith("[")) {
        return this.attributes.has(part.slice(1, -1));
      }
      return this.tagName === part;
    });
  }

  closest(selector) {
    return this.matches(selector)
      ? this
      : this.parentElement?.closest(selector) || null;
  }

  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  contains(node) {
    return this === node || this.children.some((child) => child.contains(node));
  }

  append(child) {
    child.remove();
    this.children.push(child);
    child.parentElement = this;
    mutate();
  }

  before(node) {
    this.parentElement.insertBefore(node, this);
  }

  after(node) {
    const parent = this.parentElement;
    node.remove();
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
    node.parentElement = parent;
    mutate();
  }

  insertBefore(node, reference) {
    node.remove();
    this.children.splice(this.children.indexOf(reference), 0, node);
    node.parentElement = this;
    mutate();
  }

  remove() {
    if (this.parentElement) {
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
      mutate();
    }
  }

  replaceWith(node) {
    this.before(node);
    this.remove();
  }

  cloneNode(deep) {
    const copy = this.ownerDocument.createElement(this.tagName);
    copy.attributes = new Map(this.attributes);
    copy.textContent = this.textContent;
    if (deep) {
      for (const child of this.children) {
        copy.append(child.cloneNode(true));
      }
    }
    return copy;
  }

  getBoundingClientRect() {
    return { x: 20, y: 40, width: 100, height: 80 };
  }

  addEventListener(type, callback, capture = false) {
    this.listeners.push({ type, callback, capture });
  }

  removeEventListener(type, callback, capture = false) {
    this.listeners = this.listeners.filter(
      (entry) =>
        entry.type !== type ||
        entry.callback !== callback ||
        entry.capture !== capture,
    );
  }

  focus(options) {
    this.focusCalls.push(options);
    this.ownerDocument.activeElement = this;
  }

  click() {
    return dispatch(this);
  }
}
function dispatch(target, overrides = {}) {
  const event = {
    target,
    button: 0,
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
    ...overrides,
  };
  const ancestors = [];
  for (let item = target; item; item = item.parentElement) {
    ancestors.unshift(item);
  }
  const tasks = [];
  for (const item of ancestors) {
    for (const listener of item.listeners.filter(
      (entry) => entry.type === "click" && entry.capture,
    )) {
      event.currentTarget = item;
      tasks.push(listener.callback(event));
      if (event.stopped) {
        break;
      }
    }
    if (event.stopped) {
      break;
    }
  }
  if (!event.stopped) {
    for (const listener of target.listeners.filter(
      (entry) => entry.type === "click" && !entry.capture,
    )) {
      event.currentTarget = target;
      tasks.push(listener.callback(event));
    }
  }
  if (!event.defaultPrevented && target.closest("a")?.href) {
    target.ownerDocument.navigations.push(target.closest("a").href);
  }
  return { event, done: Promise.all(tasks) };
}
function fixture() {
  const doc = {
    navigations: [],
    baseURI: "https://forum.example/",
    createElement: (tag) => new Element(tag, doc),
    querySelectorAll: (selector) => doc.body.querySelectorAll(selector),
  };
  doc.body = doc.createElement("body");
  const element = doc.createElement("div");
  doc.body.append(element);
  const add = (tag, attributes = {}, parent = element) => {
    const item = doc.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      item.setAttribute(name, value);
    }
    parent.append(item);
    return item;
  };
  return { doc, element, add };
}
const initializations = [];
const openings = [];
let initializationGate;
let initializationError;
function makeViewer(doc, url) {
  const viewer = doc.createElement("div");
  viewer.className = "pswp";
  const close = doc.createElement("button");
  close.className = "pswp__button--close";
  close.addEventListener("click", () => viewer.remove());
  viewer.append(close);
  const original = doc.createElement("a");
  original.className = "pswp__button--original-image";
  original.href = url;
  viewer.append(original);
  doc.body.append(viewer);
  return viewer;
}
const context = vm.createContext({
  URL,
  MutationObserver: class {
    constructor(callback) {
      this.callback = callback;
    }

    observe() {
      observers.add(this);
    }

    disconnect() {
      observers.delete(this);
    }
  },
  setTimeout: (callback) => {
    timers.set(++timerId, callback);
    return timerId;
  },
  clearTimeout: (id) => timers.delete(id),
});
const native = new vm.SyntheticModule(
  ["default", "sortLightboxItems"],
  function () {
    this.setExport("sortLightboxItems", (items) => [...items].reverse());
    this.setExport("default", async (gallery, options) => {
      initializations.push({ gallery, options });
      if (initializationError) {
        const error = initializationError;
        initializationError = null;
        throw error;
      }
      if (initializationGate) {
        await initializationGate;
      }
      for (const link of gallery.querySelectorAll(".lightbox")) {
        link.addEventListener("click", (event) => {
          event.preventDefault();
          openings.push(link.href);
          makeViewer(link.ownerDocument, link.href);
        });
      }
    });
  },
  { context },
);
const source = read("javascripts/discourse/lib/content-images.js");
const module = new vm.SourceTextModule(source, { context });
await module.link((specifier) => {
  assert.equal(specifier, "discourse/lib/lightbox");
  return native;
});
await module.evaluate();
const {
  contentImageUrl,
  isImageAttachment,
  prepareContentImages,
  decorateContentImages,
} = module.namespace;
for (const url of [
  "/uploads/photo.png",
  "https://example.edu/photo.jpg?q=1",
  "http://example.edu/picture",
]) {
  assert.equal(contentImageUrl(url), url);
}
for (const url of [
  undefined,
  12,
  "",
  "javascript:alert(1)",
  "data:image/png,x",
  "//evil.example/x",
  "/\\evil.example/x",
  "/img\n.png",
  "https://user:pass@example.edu/a",
  "https://",
]) {
  assert.equal(contentImageUrl(url), null, String(url));
}
for (const extension of [
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpg",
  "jpeg",
  "png",
  "svg",
  "webp",
]) {
  assert.equal(
    isImageAttachment({ name: `课表.${extension.toUpperCase()}` }),
    true,
  );
}
for (const name of [
  undefined,
  "notes.pdf",
  "photo.png.zip",
  "photo",
  "photo.heic",
  "photo.png?download=1",
]) {
  assert.equal(isImageAttachment({ name }), false);
}
const prepared = fixture();
const nativeLink = prepared.add("a", {
  class: "lightbox",
  href: "/native.jpg",
});
const nativeImage = prepared.add(
  "img",
  { src: "/native-thumbnail.jpg" },
  nativeLink,
);
for (const className of ["emoji", "avatar", "favicon", "site-logo"]) {
  prepared.add("img", { class: className, src: "/ignored.png" });
}
for (const attributes of [
  { class: "spoiler" },
  { class: "spoiled" },
  { "data-isbf-image-preview-ignore": "" },
]) {
  prepared.add(
    "img",
    { src: "/ignored.png" },
    prepared.add("span", attributes),
  );
}
prepared.add("img", { src: "javascript:alert(1)" });
const ordinary = prepared.add("img", {
  src: "/thumb.png",
  "data-large-src": "/original.png",
  width: "600",
  height: "400",
  alt: "课表",
});
const linked = prepared.add("a", { href: "/t/linked-resource/42" });
const linkedImage = prepared.add("img", { src: "/linked.png" }, linked);
const restore = prepareContentImages(prepared.element, "查看图片");
assert.equal(prepared.element.querySelectorAll(".lightbox").length, 3);
assert.equal(
  nativeImage.parentElement,
  nativeLink,
  "native lightbox links remain intact",
);
assert.equal(ordinary.parentElement.href, "https://forum.example/original.png");
assert.equal(ordinary.parentElement.getAttribute("data-target-width"), "600");
assert.equal(ordinary.parentElement.getAttribute("data-target-height"), "400");
assert.equal(ordinary.parentElement.getAttribute("aria-label"), "查看图片");
assert.equal(
  linkedImage.parentElement,
  linked,
  "linked images keep their original navigation",
);
const independentPreview = prepared.element.querySelector(
  ".isbf-content-image-attachment",
);
assert.equal(independentPreview.href, "https://forum.example/linked.png");
assert.equal(
  independentPreview.querySelector("img"),
  null,
  "separate previews do not load another image",
);
assert.equal(linked.href, "https://forum.example/t/linked-resource/42");
restore();
assert.equal(ordinary.parentElement, prepared.element);
assert.equal(prepared.element.querySelectorAll(".lightbox").length, 1);

const options = { previewLabel: "查看图片", retryLabel: "重试" };
const closeViewer = async (doc) => {
  doc
    .querySelectorAll(".pswp")[0]
    ?.querySelector(".pswp__button--close")
    .click();
  await flush();
};
const interactive = fixture();
const first = interactive.add("a", { class: "lightbox", href: "/first.png" });
const firstImage = interactive.add("img", { src: "/thumb-first.png" }, first);
const second = interactive.add("a", { class: "lightbox", href: "/second.png" });
const errors = [];
const cleanup = decorateContentImages(interactive.element, {
  ...options,
  post: { id: 7 },
  onError: (error) => errors.push(error),
});
const duplicateCleanup = decorateContentImages(interactive.element, options);
assert.equal(
  interactive.element.listeners.length,
  1,
  "one delegated capture handler per container",
);
duplicateCleanup();
let release;
initializationGate = new Promise((resolve) => {
  release = resolve;
});
const beforeInitializations = initializations.length;
const beforeOpenings = openings.length;
const click = dispatch(firstImage);
assert.equal(click.event.defaultPrevented, true);
assert.equal(click.event.stopped, true);
const repeated = dispatch(first);
await repeated.done;
assert.equal(initializations.length, beforeInitializations + 1);
assert.equal(openings.length, beforeOpenings);
release();
initializationGate = null;
await click.done;
await flush();
assert.deepEqual(openings.slice(beforeOpenings), [first.href]);
assert.deepEqual(interactive.doc.navigations, []);
const beforeActiveClick = initializations.length;
await dispatch(second).done;
assert.equal(
  initializations.length,
  beforeActiveClick,
  "an active viewer prevents a second native initialization",
);
assert.deepEqual(JSON.parse(JSON.stringify(initializations.at(-1).options)), {
  post: { id: 7 },
});
assert.notEqual(initializations.at(-1).gallery, interactive.element);
assert.deepEqual(
  initializations
    .at(-1)
    .gallery.querySelectorAll(".lightbox")
    .map((item) => item.href),
  [second.href, first.href],
);
await closeViewer(interactive.doc);
assert.equal(first.focusCalls.at(-1)?.preventScroll, true);
const third = interactive.add("a", { class: "lightbox", href: "/third.png" });
const previousSnapshot = initializations.at(-1).gallery;
await dispatch(third).done;
await flush();
assert.notEqual(initializations.at(-1).gallery, previousSnapshot);
assert.deepEqual(
  initializations
    .at(-1)
    .gallery.querySelectorAll(".lightbox")
    .map((item) => item.href),
  [third.href, second.href, first.href],
);
const viewer = interactive.doc.querySelectorAll(".pswp")[0];
viewer.querySelector(".pswp__button--original-image").href = first.href;
const errorMessage = interactive.add(
  "div",
  { class: "pswp__error-msg" },
  viewer,
);
await flush();
const retry = errorMessage.querySelector(".isbf-content-image-retry");
assert.ok(retry);
assert.equal(retry.type, "button");
assert.equal(retry.textContent, "重试");
const beforeRetry = openings.length;
retry.click();
await flush();
assert.equal(openings.length, beforeRetry + 1);
assert.equal(
  openings.at(-1),
  first.href,
  "retry follows the currently viewed image rather than the initial gallery item",
);
assert.equal(retry.disabled, true);
await closeViewer(interactive.doc);
initializationError = new Error("native initialization failed");
await dispatch(first).done;
assert.equal(errors.at(-1).message, "native initialization failed");
assert.equal(interactive.doc.querySelectorAll(".pswp").length, 0);
await dispatch(first).done;
await flush();
assert.equal(
  openings.at(-1),
  first.href,
  "initialization failures permit a later retry",
);
cleanup();
await flush();
assert.equal(interactive.element.listeners.length, 0);
assert.equal(interactive.doc.querySelectorAll(".pswp").length, 0);
assert.equal(observers.size, 0);
assert.equal(timers.size, 0);

for (const change of ["destroy", "remove", "source"]) {
  const fixtureCase = fixture();
  const link = fixtureCase.add("a", {
    class: "lightbox",
    href: "/pending.png",
  });
  const destroy = decorateContentImages(fixtureCase.element, options);
  let releasePending;
  initializationGate = new Promise((resolve) => {
    releasePending = resolve;
  });
  const previousOpenings = openings.length;
  const pending = dispatch(link);
  if (change === "destroy") {
    destroy();
  }
  if (change === "remove") {
    link.remove();
  }
  if (change === "source") {
    link.href = "/changed.png";
  }
  releasePending();
  initializationGate = null;
  await pending.done;
  await flush();
  assert.equal(
    openings.length,
    previousOpenings,
    `${change} during native initialization cancels opening`,
  );
  destroy();
}
const dynamic = fixture();
const originalRawImage = dynamic.add("img", {
  src: "/initial-raw.png",
  width: "600",
  height: "400",
});
const dynamicCleanup = decorateContentImages(dynamic.element, options);
const originalWrapper = originalRawImage.parentElement;
assert.equal(originalWrapper.href, "https://forum.example/initial-raw.png");
const appendedRawImage = dynamic.add("img", { src: "/appended-raw.png" });
assert.equal(appendedRawImage.parentElement, dynamic.element);
const appendedClick = dispatch(appendedRawImage);
await appendedClick.done;
await flush();
assert.equal(appendedClick.event.defaultPrevented, true);
assert.equal(
  openings.at(-1),
  "https://forum.example/appended-raw.png",
  "raw images appended after decoration open through the native viewer",
);
assert.notEqual(appendedRawImage.parentElement, dynamic.element);
assert.equal(dynamic.element.querySelectorAll(".lightbox").length, 2);
await closeViewer(dynamic.doc);
originalRawImage.setAttribute("src", "/updated-raw.png");
originalRawImage.setAttribute("width", "1200");
originalRawImage.setAttribute("height", "800");
await dispatch(originalRawImage).done;
await flush();
assert.equal(
  openings.at(-1),
  "https://forum.example/updated-raw.png",
  "existing wrappers refresh their original URL when the raw image source changes",
);
assert.equal(originalWrapper.getAttribute("data-target-width"), "1200");
assert.equal(originalWrapper.getAttribute("data-target-height"), "800");
await closeViewer(dynamic.doc);
initializationGate = new Promise((resolve) => {
  release = resolve;
});
const beforeDynamicPending = openings.length;
const pendingRawImage = dispatch(originalRawImage);
originalRawImage.setAttribute("src", "/changed-during-initialization.png");
release();
initializationGate = null;
await pendingRawImage.done;
await flush();
assert.equal(
  openings.length,
  beforeDynamicPending,
  "a raw image source change during initialization cancels the stale snapshot",
);
await dispatch(originalRawImage).done;
await flush();
assert.equal(
  openings.at(-1),
  "https://forum.example/changed-during-initialization.png",
);
await closeViewer(dynamic.doc);
originalRawImage.setAttribute("src", "javascript:alert(1)");
const beforeUnsafeInitialization = initializations.length;
const beforeUnsafeOpening = openings.length;
const unsafeRawClick = dispatch(originalRawImage);
await unsafeRawClick.done;
assert.equal(unsafeRawClick.event.defaultPrevented, true);
assert.equal(initializations.length, beforeUnsafeInitialization);
assert.equal(
  openings.length,
  beforeUnsafeOpening,
  "unsafe replacement sources cannot reopen a stale safe preview",
);
assert.deepEqual(dynamic.doc.navigations, []);
dynamicCleanup();
assert.equal(originalRawImage.parentElement, dynamic.element);
assert.equal(
  appendedRawImage.parentElement,
  dynamic.element,
  "cleanup unwraps images discovered after the initial decoration",
);
assert.equal(dynamic.element.querySelectorAll(".lightbox").length, 0);
assert.deepEqual(dynamic.element.querySelectorAll("img"), [
  originalRawImage,
  appendedRawImage,
]);
assert.equal(dynamic.element.listeners.length, 0);
assert.equal(observers.size, 0);
assert.equal(timers.size, 0);
const linkedContent = fixture();
const contentLink = linkedContent.add("a", { href: "/t/resource/99" });
const linkedRawImage = linkedContent.add(
  "img",
  { src: "/linked-original.png" },
  contentLink,
);
const linkedCleanup = decorateContentImages(linkedContent.element, options);
const previewLink = linkedContent.element.querySelector(
  ".isbf-content-image-attachment",
);
const beforeLinkClick = initializations.length;
await dispatch(contentLink).done;
assert.equal(initializations.length, beforeLinkClick);
assert.deepEqual(linkedContent.doc.navigations, [contentLink.href]);
for (let index = 0; index < 3; index++) {
  const linkedImageClick = dispatch(linkedRawImage);
  await linkedImageClick.done;
  assert.equal(linkedImageClick.event.defaultPrevented, false);
  assert.equal(
    linkedContent.element.querySelectorAll(".isbf-content-image-attachment")
      .length,
    1,
    "repeated scans of an existing linked image preserve one independent preview",
  );
  assert.equal(initializations.length, beforeLinkClick);
  assert.equal(linkedRawImage.parentElement, contentLink);
}
assert.equal(linkedContent.doc.navigations.length, 4);
assert.ok(
  linkedContent.doc.navigations.every((url) => url === contentLink.href),
);

await dispatch(previewLink).done;
await flush();
assert.equal(openings.at(-1), "https://forum.example/linked-original.png");
await closeViewer(linkedContent.doc);
linkedCleanup();
assert.equal(
  linkedContent.element.querySelectorAll(".isbf-content-image-attachment")
    .length,
  0,
);
assert.equal(linkedRawImage.parentElement, contentLink);
const disappearing = fixture();
const disappearingLink = disappearing.add("a", {
  class: "lightbox",
  href: "/removed-origin.png",
});
const disappearingCleanup = decorateContentImages(
  disappearing.element,
  options,
);
await dispatch(disappearingLink).done;
await flush();
disappearingLink.remove();
await flush();
assert.equal(
  disappearing.doc.querySelectorAll(".pswp").length,
  0,
  "removing the origin closes its active viewer",
);
assert.equal(
  disappearingLink.focusCalls.length,
  0,
  "removed origins never regain focus",
);
disappearingCleanup();
const ignored = fixture();
const ignoredLink = ignored.add("a", {
  class: "lightbox",
  href: "/ignored-click.png",
});
const ignoredCleanup = decorateContentImages(ignored.element, options);
for (const overrides of [
  { button: 1 },
  { ctrlKey: true },
  { metaKey: true },
  { shiftKey: true },
  { altKey: true },
]) {
  const previous = initializations.length;
  const event = dispatch(ignoredLink, overrides);
  await event.done;
  assert.equal(event.event.defaultPrevented, false);
  assert.equal(initializations.length, previous);
}
const spoiler = ignored.add("span", { class: "spoiler" });
spoiler.append(ignoredLink);
const spoilerClick = dispatch(ignoredLink);
await spoilerClick.done;
assert.equal(spoilerClick.event.defaultPrevented, false);
ignoredCleanup();
assert.equal(observers.size, 0);
assert.equal(timers.size, 0);

const modifierSource = read(
  "javascripts/discourse/modifiers/content-images.js",
);
assert.match(modifierSource, /decorateContentImages\(element/);
assert.match(modifierSource, /onError: popupAjaxError/);
assert.match(modifierSource, /isbf_v2.image_retry/);
assert.doesNotMatch(
  source,
  /scrollIntoView|window\.location|transitionTo|history\.|localStorage|sessionStorage/,
);
const styles = read("common/common.scss");
for (const selector of [
  ".isbf-content-image-attachment",
  ".pswp__button--close",
  ".isbf-content-image-retry",
]) {
  const selectorStart = styles.lastIndexOf(`${selector} {`);
  assert.ok(selectorStart >= 0, selector);
  const block = styles.slice(selectorStart, styles.indexOf("}", selectorStart));
  assert.match(block, /min-width: 44px;/);
  assert.match(block, /min-height: 44px;/);
}
assert.match(styles, /env\(safe-area-inset-top(?:,\s*0(?:px)?)?\)/);
assert.match(
  styles,
  /env\(safe-area-inset-left(?:,\s*0(?:px)?)?\).*env\(safe-area-inset-right(?:,\s*0(?:px)?)?\)/,
);
console.log(
  "Content image URL/classification, native preview lifecycle, snapshot galleries, retry, focus and static accessibility checks passed",
);
