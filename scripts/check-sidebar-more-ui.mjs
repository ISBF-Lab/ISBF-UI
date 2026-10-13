import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../javascripts/discourse/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const context = vm.createContext({});
const chineseLocale = readFileSync(
  new URL("../locales/zh_CN.yml", import.meta.url),
  "utf8",
);
const appearanceTitle = chineseLocale.match(/^\s+appearance: "([^"]+)"/m)?.[1];
assert.equal(appearanceTitle, "外观");
const settings = {
  feedback_category_id: 2,
  official_path: "/c/official/6/l/latest",
  show_right_rail: true,
};
class Component {
  constructor(args = {}) {
    this.args = args;
  }
}
const common = {
  default: Component,
  action: (value) => value,
  on: () => {},
  service: () => {},
  fn:
    (fn, ...args) =>
    (...rest) =>
      fn(...args, ...rest),
  getOwner: () => ({ lookup: () => ({ get: () => null }) }),
  i18n: (value) => (value === "isbf_v2.appearance" ? appearanceTitle : value),
  settings,
  themePrefix: (value) => value,
  notificationsEnabled: () => false,
  isFeedStyleTopic: () => false,
};
const dummy = new vm.SyntheticModule(
  Object.keys(common),
  function () {
    for (const [key, value] of Object.entries(common)) {
      this.setExport(key, value);
    }
  },
  { context },
);
const helpers = new vm.SourceTextModule(read("lib/feedback-category.js"), {
  context,
});
await helpers.link(() => {});
await helpers.evaluate();
const officialHelpers = new vm.SourceTextModule(
  read("lib/official-filters.js"),
  {
    context,
  },
);
await officialHelpers.link(() => {});
await officialHelpers.evaluate();
const { feedbackCategory, isFeedbackPath, feedbackHref, feedbackComposeHref } =
  helpers.namespace;
const category = { id: 2, url: "/c/site-feedback/2", canCreateTopic: true };
const site = { categories: [category, { id: 3, url: "/c/staff/3" }] };
assert.equal(feedbackCategory(site, "2"), category);
for (const id of [0, -2, 2.1, "bad", 99, undefined]) {
  assert.equal(feedbackCategory(site, id), null);
}
assert.equal(feedbackCategory({ categories: [] }, 2), null);
for (const path of [
  "/c/2",
  "/c/site-feedback/2",
  "/c/site-feedback/2/l/latest",
  "/c/2/l/top?period=monthly",
]) {
  assert.equal(isFeedbackPath(path, category), true, path);
}
for (const path of [
  "/latest",
  "/categories",
  "/c/general/4",
  "/c/site-feedback/20",
  "/c/staff/3",
  "/u/person/preferences",
  "/t/feedback/2",
  "/c/site-feedback/2/l/latest/extra",
]) {
  assert.equal(isFeedbackPath(path, category), false, path);
}
assert.equal(isFeedbackPath("/c/2", null), false);
assert.equal(feedbackHref(category), "/c/site-feedback/2/l/latest");
assert.equal(feedbackHref({ id: 2 }), "/c/2/l/latest");
assert.equal(feedbackHref(null), null);
assert.equal(feedbackComposeHref(category), "/new-topic?category_id=2");

const componentModules = new Map();

async function loadComponent(path) {
  const module = new vm.SourceTextModule(
    read(path)
      .replace(/<template>[\s\S]*?<\/template>/g, "")
      .replace(/@(service|action)\s+/g, ""),
    { context },
  );
  await module.link((specifier) => {
    if (specifier.endsWith("feedback-category")) {
      return helpers;
    }
    if (specifier.endsWith("official-filters")) {
      return officialHelpers;
    }
    if (specifier.endsWith("isbf-v2-appearance-modal")) {
      return componentModules.get("components/isbf-v2-appearance-modal.gjs");
    }
    return dummy;
  });
  await module.evaluate();
  componentModules.set(path, module);
  return module.namespace.default;
}
const AppearanceModal = await loadComponent(
  "components/isbf-v2-appearance-modal.gjs",
);
const appearanceTitleModal = new AppearanceModal();
assert.equal(appearanceTitleModal.title, appearanceTitle);
assert.doesNotMatch(appearanceTitleModal.title, /theme_translations|isbf_v2\./);
const UtilityActions = await loadComponent(
  "components/isbf-v2-utility-actions.gjs",
);
const calls = [];
const native = { close: async () => calls.push("close") };
for (const menu of [native, undefined]) {
  const actions = new UtilityActions({ menu });
  actions.router = { transitionTo: (path) => calls.push(path) };
  actions.dialog = { alert: async (message) => calls.push(message) };
  actions.modal = { show: (component) => calls.push(component) };
  actions.site = site;
  const before = menu ? ["close"] : [];
  assert.deepEqual(
    Array.from(actions.items, (item) => item.key),
    ["settings", "appearance", "feedback", "join"],
  );
  actions.interfaceColor = { selectorAvailable: true };
  await actions.openSettings();
  assert.deepEqual(calls.splice(0), [...before, "/login"]);
  for (const role of [
    { username: "student" },
    { username: "moderator", moderator: true },
    { username: "developer", admin: true },
    { username: "名字 /?" },
  ]) {
    actions.currentUser = role;
    await actions.openSettings();
    assert.deepEqual(calls.splice(0), [
      ...before,
      `/u/${encodeURIComponent(role.username)}/preferences`,
    ]);
  }
  for (const currentUser of [undefined, { username: "student" }]) {
    actions.currentUser = currentUser;
    const appearanceWrites = [];
    actions.interfaceColor = {
      selectorAvailable: true,
      colorMode: "dark",
      forceLightMode: () => appearanceWrites.push("light"),
      forceDarkMode: () => appearanceWrites.push("dark"),
      useAutoMode: () => appearanceWrites.push("auto"),
    };
    await actions.openAppearance();
    assert.deepEqual(calls.splice(0), [...before, AppearanceModal]);
    assert.deepEqual(appearanceWrites, [], "opening preserves the native mode");
    assert.equal(actions.interfaceColor.colorMode, "dark");
    actions.interfaceColor.selectorAvailable = false;
    await actions.openAppearance();
    assert.deepEqual(calls.splice(0), [
      ...before,
      "isbf_v2.appearance_unavailable",
    ]);
    assert.deepEqual(appearanceWrites, []);
  }
  await actions.openFeedback();
  assert.deepEqual(calls.splice(0), [...before, "/c/site-feedback/2/l/latest"]);
  actions.site = { categories: [] };
  await actions.openFeedback();
  assert.deepEqual(calls.splice(0), [
    ...before,
    "isbf_v2.feedback_unavailable",
  ]);
  await actions.openJoin();
  assert.deepEqual(calls.splice(0), [...before, Component]);
}

for (const method of [
  "openSettings",
  "openAppearance",
  "openFeedback",
  "openJoin",
]) {
  let finishClosing;
  const actions = new UtilityActions({
    menu: {
      close: () =>
        new Promise((resolve) => {
          finishClosing = resolve;
        }),
    },
  });
  actions.router = { transitionTo: (path) => calls.push(path) };
  actions.modal = { show: (component) => calls.push(component) };
  actions.site = site;
  actions.interfaceColor = { selectorAvailable: true };
  const pending = actions[method]();
  await Promise.resolve();
  assert.equal(calls.length, 0, `${method} waits for the desktop menu`);
  finishClosing();
  await pending;
  assert.equal(calls.length, 1);
  calls.splice(0);
}

const modes = ["light", "dark", "auto"];
const icons = ["sun", "moon", "circle-half-stroke"];
for (const restoredMode of [...modes, undefined]) {
  const nativeCalls = [];
  const interfaceColor = {
    selectorAvailable: true,
    colorMode: restoredMode,
    forceLightMode() {
      nativeCalls.push("light");
      this.colorMode = "light";
    },
    forceDarkMode() {
      nativeCalls.push("dark");
      this.colorMode = "dark";
    },
    useAutoMode() {
      nativeCalls.push("auto");
      this.colorMode = "auto";
    },
  };
  const appearance = new AppearanceModal({
    closeModal: () => nativeCalls.push("close"),
  });
  appearance.interfaceColor = interfaceColor;
  appearance.dialog = { alert: async (message) => nativeCalls.push(message) };
  assert.deepEqual(
    Array.from(appearance.options, ({ mode, icon, label, selected }) => ({
      mode,
      icon,
      label,
      selected,
    })),
    modes.map((mode, index) => ({
      mode,
      icon: icons[index],
      label: `isbf_v2.appearance_${mode}`,
      selected: mode === (restoredMode ?? "auto"),
    })),
    "options reflect the mode already restored by the native service",
  );
  assert.deepEqual(nativeCalls, [], "reading options preserves the mode");
  for (const mode of modes) {
    await appearance.selectMode(mode);
    assert.deepEqual(nativeCalls.splice(0), [mode, "close"]);
    assert.equal(interfaceColor.colorMode, mode);
    assert.deepEqual(
      Array.from(appearance.options, (option) => option.selected),
      modes.map((candidate) => candidate === mode),
    );
  }
  for (const mode of ["system", "", null, undefined, 0, {}]) {
    await appearance.selectMode(mode);
    assert.deepEqual(nativeCalls.splice(0), [], "invalid modes do nothing");
    assert.equal(interfaceColor.colorMode, "auto");
  }
  interfaceColor.selectorAvailable = false;
  for (const mode of modes) {
    await appearance.selectMode(mode);
    assert.deepEqual(nativeCalls.splice(0), ["isbf_v2.appearance_unavailable"]);
    assert.equal(interfaceColor.colorMode, "auto");
  }
  interfaceColor.selectorAvailable = true;
  await appearance.selectMode("dark");
  assert.deepEqual(
    nativeCalls.splice(0),
    ["dark", "close"],
    "retry uses the live service",
  );
}

const appearanceSource = read("components/isbf-v2-appearance-modal.gjs");
const utilitySource = read("components/isbf-v2-utility-actions.gjs");
assert.match(appearanceSource, /@service interfaceColor;/);
assert.match(utilitySource, /@service interfaceColor;/);
assert.match(appearanceSource, /<DModal\s/);
assert.match(
  appearanceSource,
  /get title\(\)\s*\{\s*return i18n\(themePrefix\("isbf_v2.appearance"\)\);\s*\}/,
);
assert.match(appearanceSource, /@title=\{\{this.title\}\}/);
assert.doesNotMatch(appearanceSource, /@title=\{\{themePrefix/);
assert.match(appearanceSource, /@closeModal=\{\{@closeModal\}\}/);
assert.match(appearanceSource, /<DButton\s/);
assert.match(appearanceSource, /aria-pressed=\{\{option.selected\}\}/);
assert.match(
  appearanceSource,
  /@action=\{\{fn this.selectMode option.mode\}\}/,
);
assert.match(appearanceSource, /\{\{dIcon option.icon\}\}/);
assert.match(
  appearanceSource,
  /\{\{#if option.selected\}\}[\s\S]*?dIcon "check"/,
);
const appearanceButtonBody = appearanceSource.match(
  /<DButton\b[^>]*>([\s\S]*?)<\/DButton>/,
)?.[1];
assert.ok(appearanceButtonBody, "appearance options use native buttons");
assert.match(
  appearanceButtonBody,
  /^\s*\{\{dIcon option.icon\}\}\s*<span>\{\{option.label\}\}<\/span>\s*<span\s+aria-hidden="true"\s+class="isbf-v2-appearance-modal__selected"\s*>\s*\{\{#if option.selected\}\}\s*\{\{dIcon "check"\}\}\s*\{\{\/if\}\}\s*<\/span>\s*$/,
  "the icon, label and reserved check slot are always three direct children",
);
assert.doesNotMatch(
  appearanceSource,
  /<button|role="(?:radio|button)"|tabindex=/,
);
for (const source of [appearanceSource, utilitySource]) {
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|document\.cookie|cookieStore|matchMedia|ajax\(|fetch\(|XMLHttpRequest|document\.(?:head|styleSheets|createElement)|insertRule|deleteRule|setAttribute\(|classList\.|style\./,
    "appearance delegates persistence and stylesheet changes to Discourse",
  );
}

const desktopMenuSource = read("components/isbf-v2-more-menu.gjs");
assert.match(desktopMenuSource, /<DMenu\s/);
assert.match(desktopMenuSource, /<ISBFV2UtilityActions @menu=\{\{menu\}\} \/>/);
assert.match(desktopMenuSource, /@placement=\{\{this.placement\}\}/);
assert.match(desktopMenuSource, /@modalForMobile=\{\{false\}\}/);
assert.match(
  desktopMenuSource,
  /@visibilityOptimizer=\{\{this.visibilityOptimizer\}\}/,
);
const MoreMenu = await loadComponent("components/isbf-v2-more-menu.gjs");
const desktopMenu = new MoreMenu();
const mobileMenu = new MoreMenu({ workbench: true });
assert.equal(desktopMenu.placement, "top-start");
assert.equal(desktopMenu.visibilityOptimizer, "flip");
assert.equal(desktopMenu.contentClass, "isbf-v2-more-menu");
assert.equal(desktopMenu.triggerClass, "btn-flat isbf-v2-side__more");
assert.equal(mobileMenu.placement, "top-end");
assert.equal(mobileMenu.visibilityOptimizer, "none");
assert.match(mobileMenu.contentClass, /isbf-v2-more-menu--workbench/);
assert.match(mobileMenu.triggerClass, /isbf-v2-workbench__more-trigger/);
assert.notEqual(mobileMenu.identifier, desktopMenu.identifier);
const workbenchSource = read("components/isbf-v2-workbench.gjs");
assert.match(workbenchSource, /<ISBFV2MoreMenu @workbench=\{\{true\}\} \/>/);
assert.doesNotMatch(workbenchSource, /ISBFV2UtilityActions/);
for (const page of [
  "isbf-resource-page.gjs",
  "isbf-library.gjs",
  "isbf-alumni.gjs",
]) {
  assert.doesNotMatch(read(`components/${page}`), /ISBFV2MoreMenu/);
}
function styleBlock(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start >= 0, `missing style block: ${selector}`);
  const opening = source.indexOf("{", start);
  let depth = 1;
  let end = opening + 1;
  while (end < source.length && depth) {
    if (source[end] === "{") {
      depth++;
    } else if (source[end] === "}") {
      depth--;
    }
    end++;
  }
  assert.equal(depth, 0, `unclosed style block: ${selector}`);
  return source.slice(opening + 1, end - 1);
}

const styles = readFileSync(
  new URL("../common/common.scss", import.meta.url),
  "utf8",
);
const appearanceStyles = styleBlock(
  styles,
  ".isbf-v2-appearance-modal__option {",
);
assert.match(appearanceStyles, /display: grid;/);
assert.match(
  appearanceStyles,
  /grid-template-columns: 16px minmax\(0, 1fr\) 16px;/,
);
assert.match(appearanceStyles, /gap: var\(--isbf-v2-space-3\);/);
assert.match(appearanceStyles, /(?:^|\n)\s*height: 48px;/);
assert.match(appearanceStyles, /min-height: 48px;/);
assert.match(appearanceStyles, /justify-content: stretch;/);
assert.match(appearanceStyles, /box-sizing: border-box;/);
const appearanceIconStyles = styleBlock(appearanceStyles, ".d-icon {");
assert.match(appearanceIconStyles, /(?:^|\n)\s*width: 16px;/);
assert.match(appearanceIconStyles, /(?:^|\n)\s*height: 16px;/);
assert.match(appearanceIconStyles, /margin: 0;/);
const appearanceCheckStyles = styleBlock(
  appearanceStyles,
  ".isbf-v2-appearance-modal__selected {",
);
assert.match(appearanceCheckStyles, /width: 16px;/);
assert.match(appearanceCheckStyles, /height: 16px;/);
assert.match(appearanceCheckStyles, /display: grid;/);
assert.match(appearanceCheckStyles, /place-items: center;/);
assert.doesNotMatch(appearanceCheckStyles, /margin[^:]*:.*auto/);
const selectedAppearanceStyles = styleBlock(
  appearanceStyles,
  '&[aria-pressed="true"]',
);
assert.deepEqual(
  Array.from(
    selectedAppearanceStyles.matchAll(/([\w-]+)\s*:/g),
    (match) => match[1],
  ).sort(),
  ["background", "color"],
  "selection changes colors while preserving option geometry",
);
assert.match(appearanceStyles, /width: 100%;/);
assert.match(appearanceStyles, /&\[aria-pressed="true"\]/);
assert.match(
  appearanceStyles,
  /&:focus-visible\s*\{[^}]*outline: 3px solid var\(--isbf-v2-focus-ring\);/,
);
const modalPlacementStyles = styleBlock(styles, ".isbf-v2-appearance-modal {");
const desktopPlacementStyles = styleBlock(
  modalPlacementStyles,
  "@media (width >= 601px)",
);
assert.match(
  desktopPlacementStyles,
  /(?:^|\n)\s*left: var\(--isbf-v2-feed-left\);/,
);
assert.match(
  desktopPlacementStyles,
  /(?:^|\n)\s*width: var\(--isbf-v2-feed-width\);/,
);
assert.match(desktopPlacementStyles, /align-items: center;/);
assert.equal(
  modalPlacementStyles
    .replace(`@media (width >= 601px) {${desktopPlacementStyles}}`, "")
    .trim(),
  "",
  "mobile retains native modal placement and safe area behavior",
);
const modalContainerStyles = styleBlock(
  desktopPlacementStyles,
  ".d-modal__container {",
);
for (const declaration of [
  "position: relative;",
  "min-width: 0;",
  "width: 100%;",
  "max-width: 100%;",
  "margin: 0;",
]) {
  assert.ok(modalContainerStyles.includes(declaration), declaration);
}
const feedStyles = styleBlock(
  styleBlock(styles, "body:has(.isbf-v2-shell) {"),
  "#main-outlet {",
);
assert.match(feedStyles, /width: var\(--isbf-v2-feed-width\);/);
assert.match(feedStyles, /margin: 0 0 0 var\(--isbf-v2-feed-left\);/);
const defaultFeedTokens = styleBlock(styles, ":root {");
const compactFeedTokens = styleBlock(
  styleBlock(styles, "@media (width <= 1279px)"),
  ":root {",
);
const mobileFeedTokens = styleBlock(
  styleBlock(
    styles.slice(styles.search(/@media \(width <= 600px\) \{\s*:root \{/)),
    "@media (width <= 600px)",
  ),
  ":root {",
);
assert.match(mobileFeedTokens, /--isbf-v2-feed-width: 100vw;/);
assert.match(mobileFeedTokens, /--isbf-v2-feed-left: 0px;/);
for (const tokens of [defaultFeedTokens, compactFeedTokens]) {
  assert.match(
    tokens,
    /--isbf-v2-feed-left: calc\(\s*var\(--isbf-v2-page-left\) \+ var\(--isbf-v2-left-width\) \+ var\(--isbf-v2-gap\)\s*\);/,
  );
}
const desktopMinWidth = Number(
  modalPlacementStyles.match(/@media \(width >= (\d+)px\)/)[1],
);
const compactMaxWidth = Number(
  styles.match(
    /@media \(width <= (\d+)px\) \{\s*:root \{\s*--isbf-v2-left-width: 220px;/,
  )[1],
);
for (const [width, desktop] of [
  [390, false],
  [430, false],
  [1024, true],
  [1440, true],
]) {
  assert.equal(
    width >= desktopMinWidth,
    desktop,
    `${width}px native mobile/desktop placement boundary`,
  );
  if (desktop) {
    const tokens =
      width <= compactMaxWidth ? compactFeedTokens : defaultFeedTokens;
    assert.match(
      tokens,
      /--isbf-v2-feed-width: 600px;/,
      `${width}px modal and feed resolve the same shared width token`,
    );
  }
}
assert.match(styles, /\.isbf-v2-workbench__more\s*\{\s*display: none;/);
assert.doesNotMatch(styles, /\.isbf-v2-workbench__actions\s*\{/);
const mobileStyles = styles.slice(
  styles.indexOf(
    "@media (width <= 600px)",
    styles.indexOf(".isbf-v2-workbench__name"),
  ),
);
assert.match(
  mobileStyles,
  /\.isbf-v2-workbench\s*\{\s*display: flex;\s*flex-direction: column;\s*min-height: 100dvh;/,
);
assert.match(
  mobileStyles,
  /padding-bottom: calc\(\s*64px \+ var\(--isbf-v2-space-4\) \+ env\(safe-area-inset-bottom\)\s*\);/,
);
const footerStyles = mobileStyles.match(
  /\.isbf-v2-workbench__more\s*\{([^}]+)\}/,
)[1];
assert.match(footerStyles, /display: flex;\s*justify-content: flex-end;/);
assert.match(footerStyles, /margin-top: auto;/);
assert.match(footerStyles, /padding-top: var\(--isbf-v2-space-6\);/);
assert.doesNotMatch(footerStyles, /position: (?:fixed|absolute|sticky)/);
const actionStyles = mobileStyles.match(
  /\.isbf-v2-workbench__more-trigger\s*\{([\s\S]+?)\n  \}/,
)[1];
assert.match(actionStyles, /min-height: 44px;/);
assert.match(actionStyles, /min-width: 44px;/);
assert.match(actionStyles, /display: grid;/);
assert.match(actionStyles, /width: 23px;\s*height: 23px;/);
assert.match(actionStyles, /font-size: 10px;/);
assert.match(actionStyles, /color: var\(--isbf-v2-text\);/);
assert.match(actionStyles, /&:hover,\s*&:focus-visible/);
const workbenchMediaStart = styles.indexOf(
  "@media (width <= 600px)",
  styles.indexOf(".isbf-v2-workbench__name"),
);
const workbenchMobileStyles = styleBlock(
  styles.slice(workbenchMediaStart),
  "@media (width <= 600px)",
);
const triggerStyles = styleBlock(
  workbenchMobileStyles,
  ".isbf-v2-workbench__more-trigger {",
);
const iconStyles = styleBlock(triggerStyles, ".d-icon {");
assert.match(iconStyles, /transform: translateY\(-8px\);/);
assert.equal(
  Array.from(styles.matchAll(/transform:\s*translateY\(-8px\);/g)).length,
  1,
  "the offset is scoped to the mobile workbench icon",
);
assert.doesNotMatch(
  triggerStyles.replace(`.d-icon {${iconStyles}}`, ""),
  /transform:/,
  "the trigger and its label keep their position",
);
assert.match(
  workbenchMobileStyles,
  /\.isbf-v2-workbench__more-control\s*\{\s*width: 25%;\s*min-width: 44px;/,
);
const mobileMaxWidth = Number(
  styles.slice(workbenchMediaStart).match(/^@media \(width <= (\d+)px\)/)[1],
);
const iconOffset = Number(iconStyles.match(/translateY\((-?\d+)px\)/)[1]);
for (const [width, expectedOffset] of [
  [390, -8],
  [430, -8],
  [1024, 0],
]) {
  assert.equal(
    width <= mobileMaxWidth ? iconOffset : 0,
    expectedOffset,
    `${width}px applies the icon offset only within the mobile media rule`,
  );
}
for (const width of [390, 430]) {
  const cellWidth = width / 4;
  const minHeight = Number(triggerStyles.match(/min-height: (\d+)px;/)[1]);
  const minWidth = Number(triggerStyles.match(/min-width: (\d+)px;/)[1]);
  assert.ok(
    cellWidth >= minWidth && minWidth >= 44 && minHeight >= 44,
    `${width}px retains a 44px target`,
  );
}

const Shell = await loadComponent("components/isbf-v2-shell.gjs");
const shell = new Shell();
shell.site = site;
shell.siteSettings = {};
shell.router = { currentURL: "/c/site-feedback/2/l/latest" };
assert.equal(shell.pageKind, "feed");
assert.equal(shell.isFeedback, true);
assert.equal(shell.composeHref, "/new-topic?category_id=2");
assert.equal(shell.canCompose, true);
shell.currentUser = { username: "student" };
assert.equal(shell.canCompose, true);
category.canCreateTopic = false;
assert.equal(shell.canCompose, false);
assert.equal(shell.showMobileCompose, false);
category.canCreateTopic = true;
assert.equal(shell.showMobileReview, false);
assert.equal(shell.shellClass.includes("isbf-v2-shell--feedback"), true);
shell.router.currentURL = "/latest";
assert.equal(shell.isFeedback, false);
assert.equal(shell.composeHref, "/new-topic");
shell.router.currentURL = "/c/general/4/l/latest";
assert.equal(shell.pageKind, "explore");

const Connector = await loadComponent(
  "connectors/topic-list-item/isbf-feed-card.gjs",
);
const connector = new Connector({ outletArgs: { bulkSelectEnabled: false } });
connector.site = site;
connector.router = { currentURL: "/c/site-feedback/2/l/latest" };
assert.equal(connector.shouldRenderCard, true);
connector.args.outletArgs.bulkSelectEnabled = true;
assert.equal(connector.shouldRenderCard, false);
connector.args.outletArgs.bulkSelectEnabled = false;
connector.router.currentURL = "/c/general/4/l/latest";
assert.equal(connector.shouldRenderCard, false);

const Join = await loadComponent("components/isbf-v2-join-modal.gjs");
const join = new Join();
assert.equal(join.description, "isbf_v2.join_us_pending");
settings.join_us_description = "开发、运营\n联系：team@example.invalid";
assert.equal(join.description, settings.join_us_description);
console.log(
  "Sidebar actions, native appearance VM interactions/source constraints, feedback permissions, card reuse and recruitment settings OK",
);
