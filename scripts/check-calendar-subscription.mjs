import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const calls = [];
const confirmations = [];
let handler;
let confirm = true;
let copied;
let copyFails = false;
let nextModel = {};
let navigationRect = { width: 390, height: 64, top: 780 };
const emittedURLs = [];
const user = { id: 7 };
const context = vm.createContext({
  URL,
  window: { location: { origin: "https://isbf.test" }, innerHeight: 844 },
  document: {
    querySelector: () => ({ getBoundingClientRect: () => navigationRect }),
  },
});
const synthetic = (values) =>
  new vm.SyntheticModule(
    Object.keys(values),
    function () {
      for (const [key, value] of Object.entries(values)) {
        this.setExport(key, value);
      }
    },
    { context }
  );
const helper = new vm.SourceTextModule(
  read("javascripts/discourse/lib/calendar-subscription.js"),
  { context }
);
await helper.link(() => {});
await helper.evaluate();
const { appleCalendarURL, calendarSubscriptionURL } = helper.namespace;
const url =
  "https://isbf.test/isbf/api/calendar.ics?user_api_key=test-private-key";
assert.equal(
  appleCalendarURL(url, "https://isbf.test", "/isbf/api/calendar.ics"),
  url.replace("https:", "webcal:")
);
assert.equal(
  calendarSubscriptionURL(url, "https://isbf.test", "/isbf/api/calendar.ics"),
  url
);
for (const invalid of [
  null,
  "bad",
  url.replace("https:", "http:"),
  url.replace("isbf.test", "other.test"),
  url.replace("/calendar.ics", "/entries.json"),
  "https://isbf.test/isbf/api/calendar.ics",
  url + "#fragment",
  url.replace("https://", "https://user:password@"),
]) {
  assert.equal(
    appleCalendarURL(invalid, "https://isbf.test", "/isbf/api/calendar.ics"),
    null
  );
}
assert.ok(
  appleCalendarURL(
    url.replace("/isbf/", "/forum/isbf/"),
    "https://isbf.test",
    "/forum/isbf/api/calendar.ics"
  )
);

class Component {
  constructor() {
    this.args = {
      model: {
        userId: 7,
        onURLChange: (value) => emittedURLs.push(value),
        ...nextModel,
      },
    };
    this.currentUser = user;
    this.dialog = {
      confirm: async (options) => {
        confirmations.push(options);
        return confirm;
      },
    };
  }

  willDestroy() {}
}
const source = read(
  "javascripts/discourse/components/isbf-calendar-subscription.gjs"
);
const module = new vm.SourceTextModule(
  source
    .replace(/<template>[\s\S]*<\/template>/, "")
    .replace(/^\s*@service\s+\w+;\s*$/gm, "")
    .replace(/@(tracked|action)\s+/g, ""),
  { context }
);
const dependencies = {
  "@glimmer/component": { default: Component },
  "@glimmer/tracking": { tracked: null },
  "@ember/object": { action: null },
  "@ember/service": { service: null },
  "virtual:theme": { themePrefix: (key) => key },
  "discourse/lib/ajax": {
    ajax: async (path, options = {}) => {
      calls.push({ path, ...options });
      return handler(path, options);
    },
  },
  "discourse/lib/get-url": { default: (path) => path },
  "discourse/lib/utilities": {
    clipboardCopy: async (value) => {
      if (copyFails) {
        throw new Error("Clipboard denied");
      }
      copied = value;
    },
  },
  "discourse/ui-kit/d-button": { default: null },
  "discourse/ui-kit/d-modal": { default: null },
  "discourse/ui-kit/helpers/d-icon": { default: null },
  "discourse-i18n": { i18n: (key) => key },
};
await module.link((name) =>
  name === "../lib/calendar-subscription"
    ? helper
    : synthetic(dependencies[name])
);
await module.evaluate();
const Dialog = module.namespace.default;
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};
handler = async () => ({
  has_subscription: true,
  feeds: ["isbf_personal"],
  generated_feeds: [],
});
const dialog = new Dialog();
await flush();
assert.equal(dialog.ready, true);
assert.equal(dialog.loading, false);
assert.equal(calls.length, 1);
assert.equal(calls[0].type, undefined, "opening only reads native status");
confirm = false;
await dialog.generate();
assert.equal(
  calls.length,
  1,
  "cancelling does not revoke/regenerate existing subscriptions"
);
assert.equal(dialog.hasSubscription, true);
confirm = true;
let resolve;
handler = () =>
  new Promise((done) => {
    resolve = done;
  });
const pending = dialog.generate();
await flush();
await dialog.generate();
assert.equal(
  calls.filter((call) => call.type === "POST").length,
  1,
  "duplicate generation is blocked"
);
resolve({ urls: { isbf_personal: url } });
await pending;
assert.equal(dialog.webcalURL, url.replace("https:", "webcal:"));
await dialog.copy();
assert.equal(copied, url);
assert.equal(emittedURLs.at(-1), url);
copyFails = true;
await dialog.copy();
assert.equal(dialog.error, true);
assert.equal(dialog.copied, false);
assert.equal(
  dialog.subscriptionURL,
  url,
  "copy errors retain a selectable URL"
);
copyFails = false;
user.id = 8;
assert.equal(
  dialog.webcalURL,
  null,
  "account changes cannot expose the previous owner's URL"
);
await dialog.revoke();
assert.equal(calls.filter((call) => call.type === "DELETE").length, 0);
user.id = 7;
confirm = false;
await dialog.revoke();
assert.equal(calls.filter((call) => call.type === "DELETE").length, 0);
confirm = true;
handler = async () => {
  throw new Error("network");
};
await dialog.revoke();
assert.equal(dialog.error, true);
assert.ok(dialog.webcalURL, "failed revocation keeps input for retry");
handler = async () => ({});
await dialog.revoke();
assert.equal(dialog.url, null);
assert.equal(dialog.hasSubscription, false);
assert.equal(emittedURLs.at(-1), null);
assert.ok(confirmations.some((item) => item.message.endsWith("replace")));
assert.ok(
  confirmations.some((item) => item.message.endsWith("revoke_confirm"))
);

handler = async () => {
  throw new Error("failed status");
};
const failed = new Dialog();
await flush();
assert.equal(failed.error, true);
assert.equal(failed.ready, false);
handler = async () => ({ has_subscription: false, feeds: ["isbf_personal"] });
await failed.load();
assert.equal(failed.ready, true);
assert.equal(failed.error, false);
handler = async () => {
  throw new Error("failed generation");
};
await failed.generate();
assert.equal(failed.error, true);
assert.equal(failed.hasSubscription, false);
handler = async () => ({ urls: { isbf_personal: url } });
await failed.generate();
assert.ok(failed.webcalURL);

handler = async () => ({ has_subscription: true, feeds: ["bookmarks"] });
const unavailable = new Dialog();
await flush();
const previousCalls = calls.length;
await unavailable.generate();
assert.equal(
  calls.length,
  previousCalls,
  "missing plugin capability cannot regenerate keys"
);
handler = () =>
  new Promise((done) => {
    resolve = done;
  });
const destroyed = new Dialog();
destroyed.isDestroying = true;
destroyed.willDestroy();
resolve({ has_subscription: true, feeds: ["isbf_personal"] });
await flush();
assert.equal(
  destroyed.ready,
  false,
  "destroyed components ignore stale responses"
);

for (const provider of ["apple", "google", "outlook", "link"]) {
  nextModel = { provider, initialUrl: url };
  let settle;
  handler = () =>
    new Promise((done) => {
      settle = done;
    });
  const cached = new Dialog();
  assert.equal(
    cached.subscriptionURL,
    null,
    "cached URLs wait for native status"
  );
  settle({
    has_subscription: true,
    feeds: ["isbf_personal"],
    generated_feeds: ["isbf_personal"],
  });
  await flush();
  assert.equal(cached.subscriptionURL, url);
  assert.equal(
    cached.webcalURL,
    provider === "apple" ? url.replace("https:", "webcal:") : null
  );
  assert.ok(cached.title.endsWith(`${provider}_title`));
  assert.ok(cached.guide.endsWith(`${provider}_guide`));
  cached.willDestroy();
  assert.equal(cached.url, null, "dialog disposal clears its own URL");
  assert.equal(
    emittedURLs.at(-1),
    null,
    "disposal does not revoke the page cache"
  );
}
nextModel = { provider: "link", initialUrl: url };
handler = async () => ({
  has_subscription: false,
  feeds: ["isbf_personal"],
  generated_feeds: [],
});
const absent = new Dialog();
await flush();
assert.equal(absent.url, null);
assert.equal(emittedURLs.at(-1), null);
handler = async () => ({
  has_subscription: true,
  feeds: ["isbf_personal"],
  generated_feeds: [],
});
const legacy = new Dialog();
await flush();
assert.equal(
  legacy.subscriptionURL,
  null,
  "old scopes cannot validate a page URL"
);
handler = async () => {
  throw new Error("Status unavailable");
};
const cachedFailure = new Dialog();
await flush();
assert.equal(
  cachedFailure.subscriptionURL,
  null,
  "failed status never exposes a cached URL"
);
handler = async () => ({
  has_subscription: true,
  feeds: ["isbf_personal"],
  generated_feeds: ["isbf_personal"],
});
await cachedFailure.load();
assert.equal(cachedFailure.subscriptionURL, url);
handler = async () => ({
  urls: { isbf_personal: "https://evil.test/calendar.ics?user_api_key=bad" },
});
await cachedFailure.generate();
assert.equal(cachedFailure.error, true);
assert.equal(cachedFailure.subscriptionURL, null);
assert.equal(
  emittedURLs.at(-1),
  null,
  "invalid successful regeneration invalidates the old cache"
);
nextModel = {};

const trigger = read(
  "javascripts/discourse/components/isbf-calendar-subscribe.gjs"
);
const triggerModule = new vm.SourceTextModule(
  trigger
    .replace(/<template>[\s\S]*<\/template>/, "")
    .replace(/^\s*@service\s+\w+;\s*$/gm, "")
    .replace(/@(tracked|action)\s+/g, ""),
  { context }
);
const triggerDependencies = {
  ...dependencies,
  "@glimmer/tracking": { tracked: null },
  "@ember/helper": { fn: null },
  "discourse/float-kit/components/d-menu": { default: null },
  "discourse/lib/offset-calculator": { headerOffset: () => 0 },
  "discourse/ui-kit/d-dropdown-menu": { default: null },
  "./isbf-calendar-provider-icon": { default: null },
  "./isbf-calendar-subscription": { default: Dialog },
};
await triggerModule.link((name) =>
  name === "../lib/calendar-subscription"
    ? helper
    : synthetic(triggerDependencies[name])
);
await triggerModule.evaluate();
const Trigger = triggerModule.namespace.default;
const rootTrigger = new Trigger();
const nativeMenu = { options: {} };
rootTrigger.registerMenu(nativeMenu);
assert.deepEqual(Array.from(nativeMenu.options.allowedPlacements), [
  "top-end",
  "bottom-end",
]);
assert.equal(
  nativeMenu.options.padding.bottom,
  76,
  "menu avoids the mobile tab bar"
);
navigationRect = { width: 0, height: 0, top: 0 };
assert.equal(
  nativeMenu.options.padding.bottom,
  12,
  "hidden tabs do not reserve space on desktop"
);
context.window.visualViewport = { offsetTop: 0, height: 600 };
navigationRect = { width: 390, height: 64, top: 536 };
assert.equal(
  nativeMenu.options.padding.bottom,
  76,
  "viewport resizing rereads tab bounds"
);
rootTrigger.positioned({ dataset: { placement: "top-end" } });
assert.equal(rootTrigger.opensUp, true);
rootTrigger.positioned({ dataset: { placement: "bottom-end" } });
assert.equal(rootTrigger.opensUp, false);
rootTrigger.site = { isbf_calendar: { subscription_feed: "isbf_personal" } };
const shown = [];
rootTrigger.modal = { show: (...args) => shown.push(args) };
assert.deepEqual(
  Array.from(rootTrigger.providers, (item) => item.id),
  ["apple", "google", "outlook", "link"]
);
let closeCalls = 0;
const menu = {
  close: () => {
    closeCalls++;
    return new Promise((done) => {
      resolve = done;
    });
  },
};
const opening = rootTrigger.open("apple", menu);
await rootTrigger.open("google", menu);
assert.equal(closeCalls, 1, "repeated menu selection opens only once");
assert.equal(shown.length, 0, "modal waits for native menu close");
resolve();
await opening;
assert.equal(shown[0][1].model.provider, "apple");
shown[0][1].model.onURLChange(url);
await rootTrigger.open("google", { close: async () => {} });
assert.equal(
  shown[1][1].model.initialUrl,
  url,
  "platform switching reuses this page's generated URL"
);
const oldCallback = shown[1][1].model.onURLChange;
user.id = 8;
assert.ok(rootTrigger.available);
oldCallback(url);
await rootTrigger.open("outlook", { close: async () => {} });
assert.equal(
  shown[2][1].model.initialUrl,
  null,
  "account changes clear the previous owner's cache"
);
user.id = 7;
await rootTrigger.open("link", { close: async () => {} });
assert.equal(
  shown[3][1].model.initialUrl,
  null,
  "switching back cannot resurrect a cleared URL"
);
shown[3][1].model.onURLChange(url);
let ownedModalClosed = false;
rootTrigger.modal.activeModal = { opts: { model: shown[3][1].model } };
rootTrigger.modal.close = () => {
  ownedModalClosed = true;
};
rootTrigger.isDestroying = true;
rootTrigger.willDestroy();
assert.equal(
  ownedModalClosed,
  true,
  "leaving the calendar closes only its owned modal"
);
assert.equal(shown[3][1].model.isOwnerCurrent(), false);
oldCallback(url);
await rootTrigger.open("apple", { close: async () => {} });
assert.equal(shown.length, 4, "leaving the page prevents stale modal launches");
const guest = new Trigger();
guest.currentUser = null;
guest.site = rootTrigger.site;
assert.equal(guest.available, null);
assert.match(
  trigger,
  /this\.currentUser &&[\s\S]*subscription_feed === PERSONAL_CALENDAR_FEED/
);
assert.match(source, /<DModal[\s\S]*@closeModal=/);
assert.doesNotMatch(source, /localStorage|sessionStorage|console\./);
assert.doesNotMatch(trigger, /localStorage|sessionStorage|console\./);
assert.match(trigger, /@modalForMobile=\{\{false\}\}/);
assert.match(trigger, /@placement="bottom-end"/);
assert.match(trigger, /@visibilityOptimizer="autoPlacement"/);
assert.match(trigger, /@onRegisterApi=\{\{this\.registerMenu\}\}/);
assert.match(trigger, /@onPositioned=\{\{this\.positioned\}\}/);
const calendar = read("javascripts/discourse/components/isbf-v2-calendar.gjs");
assert.equal((calendar.match(/<ISBFCalendarSubscribe\s*\/>/g) || []).length, 1);
assert.match(
  calendar,
  /class="isbf-v2-calendar__month-footer"[\s\S]*?class="isbf-v2-calendar__legend"[\s\S]*?<ISBFCalendarSubscribe\s*\/>/
);
assert.doesNotMatch(
  calendar.slice(
    calendar.indexOf('<div class="isbf-v2-calendar__heading">'),
    calendar.indexOf('class="isbf-v2-calendar__filters"')
  ),
  /ISBFCalendarSubscribe/
);
assert.match(source, /readonly[\s\S]*value=\{\{this\.subscriptionURL\}\}/);
const providerURLs = [...source.matchAll(/href="(https:[^"]+)"/g)].map(
  (match) => match[1]
);
assert.deepEqual(providerURLs, [
  "https://calendar.google.com/calendar/",
  "https://outlook.live.com/calendar/",
  "https://outlook.office.com/calendar/",
]);
for (const value of providerURLs) {
  assert.equal(
    new URL(value).search,
    "",
    "provider sites never receive subscription credentials"
  );
}
assert.match(
  read("javascripts/discourse/api-initializers/isbf-calendar-subscription.gjs"),
  /calendar-subscriptions-feeds/
);
assert.match(
  read("javascripts/discourse/components/isbf-calendar-subscription-feed.gjs"),
  /<CalendarSubscriptionUrl/
);
const style = read("stylesheets/official-calendar.scss");
assert.match(
  style,
  /\.isbf-v2-calendar__month-footer\s*\{[\s\S]*?justify-content: space-between;/
);
assert.match(
  style,
  /\.isbf-v2-calendar__legend\s*\{[\s\S]*?justify-content: flex-start;/
);
assert.match(style, /min-height: 44px/);
assert.match(
  style,
  /\.dropdown-menu\s*\{[^}]*?width: 100%;[^}]*?min-width: 0;/
);
assert.match(style, /safe-area-inset-bottom/);
assert.match(style, /flex-wrap: wrap/);
assert.match(
  style,
  /\.isbf-calendar-subscription-menu__item[\s\S]*?height: 48px;[\s\S]*?min-height: 48px;/
);
assert.match(
  style,
  /\.isbf-calendar-provider-icon\s*\{[\s\S]*?flex: 0 0 20px;/
);
assert.match(
  style,
  /@media \(width <= 600px\)[\s\S]*?\.isbf-v2-feature \.isbf-v2-calendar__heading\s*\{[\s\S]*?flex-wrap: nowrap;/
);
assert.match(style, /max-width: calc\([\s\S]*?safe-area-inset-right/);
const icons = read(
  "javascripts/discourse/components/isbf-calendar-provider-icon.gjs"
);
assert.match(icons, /<svg[\s\S]*?aria-hidden="true"/);
assert.doesNotMatch(icons, /https?:|<script|<image/);
for (const locale of ["en", "zh_CN"]) {
  const yaml = read(`locales/${locale}.yml`);
  assert.match(yaml, /^    calendar_subscription_apple: "Apple"$/m);
  assert.match(yaml, /^    calendar_subscription_google: "Google"$/m);
  for (const key of [
    "calendar_subscribe_apple",
    "calendar_subscription_replace",
    "calendar_subscription_revoke_confirm",
    "calendar_subscription_description",
    "calendar_subscription_error",
  ]) {
    assert.ok(yaml.includes(`    ${key}:`));
  }
}
process.stdout.write(
  "Calendar provider menu, native subscriptions, page cache, owner isolation, retry and layout checks OK\n"
);
