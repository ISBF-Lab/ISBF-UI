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
const user = { id: 7 };
const context = vm.createContext({
  URL,
  window: { location: { origin: "https://isbf.test" } },
});
const synthetic = (values) =>
  new vm.SyntheticModule(
    Object.keys(values),
    function () {
      for (const [key, value] of Object.entries(values))
        this.setExport(key, value);
    },
    { context }
  );
const helper = new vm.SourceTextModule(
  read("javascripts/discourse/lib/calendar-subscription.js"),
  { context }
);
await helper.link(() => {});
await helper.evaluate();
const { appleCalendarURL } = helper.namespace;
const url =
  "https://isbf.test/isbf/api/calendar.ics?user_api_key=test-private-key";
assert.equal(
  appleCalendarURL(url, "https://isbf.test", "/isbf/api/calendar.ics"),
  url.replace("https:", "webcal:")
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
    this.args = { model: { userId: 7 } };
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
  for (let i = 0; i < 5; i++) await Promise.resolve();
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

const trigger = read(
  "javascripts/discourse/components/isbf-calendar-subscribe.gjs"
);
assert.match(
  trigger,
  /this\.currentUser &&[\s\S]*subscription_feed === PERSONAL_CALENDAR_FEED/
);
assert.match(source, /<DModal[\s\S]*@closeModal=/);
assert.doesNotMatch(source, /localStorage|sessionStorage|console\./);
assert.match(
  read("javascripts/discourse/api-initializers/isbf-calendar-subscription.gjs"),
  /calendar-subscriptions-feeds/
);
assert.match(
  read("javascripts/discourse/components/isbf-calendar-subscription-feed.gjs"),
  /<CalendarSubscriptionUrl/
);
const style = read("stylesheets/official-calendar.scss");
assert.match(style, /min-height: 44px/);
assert.match(style, /safe-area-inset-bottom/);
assert.match(style, /flex-wrap: wrap/);
for (const locale of ["en", "zh_CN"]) {
  const yaml = read(`locales/${locale}.yml`);
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
console.log(
  "Private calendar subscription, native key lifecycle, owner isolation, retry and layout checks OK"
);
