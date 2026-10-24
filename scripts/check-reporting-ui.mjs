import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const source = (path) =>
  readFileSync(new URL(path, root), "utf8").replace(/^\uFEFF/, "");
async function load(text, dependencies) {
  const module = new vm.SourceTextModule(text);
  await module.link((name) => {
    const values = dependencies[name];
    assert.ok(values, `Missing stub for ${name}`);
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) {
        this.setExport(key, value);
      }
    });
  });
  await module.evaluate();
  return module.namespace;
}
const pending = [];
const loader = await load(
  source("javascripts/discourse/lib/feed-post-loader.js"),
  {
    "discourse/lib/ajax": {
      ajax: () =>
        new Promise((resolve, reject) => pending.push({ resolve, reject })),
    },
  }
);
const oldRequest = loader.loadCookedPost(12);
loader.invalidateCookedPost(12);
pending[0].resolve({ cooked: "stale body" });
assert.equal(await oldRequest, "");
assert.equal(await loader.loadCookedPost(12), "");
loader.invalidateCookedPost(12, false);
const restored = loader.loadCookedPost(12);
pending[1].resolve({ cooked: "restored body" });
assert.equal(await restored, "restored body");
assert.equal(await loader.loadCookedPost(12), "restored body");

class NativeFlag {
  constructor(_owner, args) {
    this.args = args;
  }
  onKeydown() {
    this.ordinaryShortcut = true;
  }
}
const requests = [];
const stripped = source("javascripts/discourse/components/isbf-flag-modal.gjs")
  .replace(/<template>[\s\S]*?<\/template>/g, "")
  .replace(/@(tracked|action)\s+/g, "");
const defaults = {
  default: {},
  tracked() {},
  action() {},
  on() {},
  trustHTML() {},
  themePrefix: (key) => key,
  lazyHash() {},
  not() {},
  i18n: (key) => key,
};
const names = [...stripped.matchAll(/from "([^"]+)"/g)].map(
  (match) => match[1]
);
const dependencies = Object.fromEntries(names.map((name) => [name, defaults]));
dependencies["discourse/components/modal/flag"] = { default: NativeFlag };
dependencies["discourse/lib/ajax"] = {
  ajax: (url, options) =>
    new Promise((resolve, reject) =>
      requests.push({ url, options, resolve, reject })
    ),
};
const modalModule = await load(stripped, dependencies);
let closed = 0;
let hidden = 0;
const post = {
  id: 12,
  setProperties(values) {
    Object.assign(this, values);
  },
};
const modal = new modalModule.default(null, {
  model: {
    canSevereReport: () => true,
    flagModel: post,
    setHidden() {
      hidden++;
    },
  },
  closeModal() {
    closed++;
  },
});
modal.selected = { name_key: "spam" };
modal.message = "ordinary message";
modal.enterSevere();
assert.equal(modal.severeSubmitEnabled, false);
modal.severeReason = "1234567890";
assert.equal(modal.severeSubmitEnabled, false);
modal.severeConfirmed = true;
assert.equal(modal.severeSubmitEnabled, true);
modal.severeReason = "x".repeat(2001);
assert.equal(modal.severeSubmitEnabled, false);
modal.severeReason = " 1234567890 ";
const failed = modal.submitSevere();
assert.equal(modal.severeSubmitting, true);
modal.closeReporting();
assert.equal(closed, 0);
await modal.submitSevere();
assert.equal(requests.length, 1);
assert.equal(requests[0].options.contentType, "application/json");
assert.deepEqual(JSON.parse(requests[0].options.data), {
  post_id: 12,
  reason: "1234567890",
  confirmed: true,
});
requests[0].reject({ jqXHR: { responseJSON: { errors: ["Try again"] } } });
await failed;
assert.equal(modal.severeError, "Try again");
assert.equal(modal.severeReason, " 1234567890 ");
assert.equal(hidden, 0);
const retry = modal.submitSevere();
requests[1].resolve({ post_id: 12, hidden: true, reviewable_id: 4 });
await retry;
assert.equal(hidden, 1);
assert.equal(closed, 1);
assert.equal(post.cooked, "");
assert.equal(post.isbf_severe_report_pending, true);
assert.equal(modal.selected.name_key, "spam");
assert.equal(modal.message, "ordinary message");
modal.leaveSevere();
modal.handleReportingKeydown({ key: "Enter", ctrlKey: true });
assert.equal(modal.ordinaryShortcut, true);

class StandardModal {}
class SevereModal {}
const events = [];
const helper = await load(source("javascripts/discourse/lib/report-post.js"), {
  "discourse/components/modal/flag": { default: StandardModal },
  "discourse/lib/flag-targets/post-flag": { default: class PostFlag {} },
  "../components/isbf-flag-modal": { default: SevereModal },
  "./feed-post-loader": { invalidateCookedPost: loader.invalidateCookedPost },
});
const settings = { isbf_severe_reports_enabled: true };
const eligible = {
  id: 22,
  isbf_can_severe_report: true,
  post_type: 1,
  topic: {},
  set() {},
  setProperties(values) {
    Object.assign(this, values);
  },
};
assert.equal(helper.severeReportAvailable(eligible, settings), true);
assert.equal(helper.severeReportAvailable(eligible, {}), false);
assert.equal(
  helper.severeReportAvailable({ ...eligible, post_type: 3 }, settings),
  false
);
assert.equal(
  helper.severeReportAvailable(
    { ...eligible, topic: { archetype: "private_message" } },
    settings
  ),
  false
);
assert.equal(
  helper.severeReportAvailable(
    { ...eligible, isbf_severe_report_pending: true },
    settings
  ),
  false
);
const shown = [];
const services = {
  post: eligible,
  modal: {
    show(...args) {
      shown.push(args);
    },
  },
  siteSettings: settings,
  appEvents: {
    trigger(...args) {
      events.push(args);
    },
  },
};
helper.openPostReport(services);
assert.equal(shown[0][0], SevereModal);
helper.rememberHiddenPost(22, services.appEvents);
assert.equal(helper.isReportedHidden(22), true);
assert.equal(eligible.hidden, true);
helper.rememberHiddenPost(22, services.appEvents, false);
assert.equal(helper.isReportedHidden(22), false);
assert.equal(eligible.hidden, false);
helper.openPostReport({ ...services, siteSettings: {} });
assert.equal(shown[1][0], SevereModal);
assert.equal(shown[1][1].model.canSevereReport(), false);
assert.equal(
  helper.severeReportAvailable(eligible, settings, {
    isbf_severe_reports_enabled: false,
  }),
  false
);
assert.equal(
  helper.severeReportAvailable(
    eligible,
    {},
    { isbf_severe_reports_enabled: true }
  ),
  true
);
shown[1][1].model.setHidden();
assert.equal(eligible.isbf_severe_report_pending, false);
helper.rememberHiddenPost(22, services.appEvents, false);
console.log(
  "Severe validation, duplicate-submit protection, retry, native state retention, capability fallback and stale cooked-cache invalidation OK"
);

let routeOverride;
let flagDecision;
let broadcast;
const servicesByName = {
  "service:app-events": services.appEvents,
  "service:site-settings": settings,
  "service:current-user": { id: 5 },
  "service:message-bus": {
    subscribe(channel, callback) {
      assert.equal(channel, "/isbf/moderation/posts");
      broadcast = callback;
    },
  },
};
const initializer = await load(
  source("javascripts/discourse/api-initializers/isbf-reporting.gjs"),
  {
    "discourse/lib/api": { apiInitializer: (callback) => callback },
    "../lib/report-post": {
      openPostReport: helper.openPostReport,
      rememberHiddenPost: helper.rememberHiddenPost,
      severeReportAvailable: helper.severeReportAvailable,
    },
  }
);
initializer.default({
  container: { lookup: (name) => servicesByName[name] },
  registerValueTransformer(name, callback) {
    assert.equal(name, "flag-button-render-decision");
    flagDecision = callback;
  },
  modifyClass(name, definition) {
    assert.equal(name, "route:topic");
    routeOverride = definition;
  },
});
assert.equal(flagDecision({ value: false, context: { post: eligible } }), true);
assert.equal(
  flagDecision({
    value: true,
    context: { post: { ...eligible, post_type: 3 } },
  }),
  true
);
assert.equal(
  flagDecision({
    value: false,
    context: { post: { ...eligible, post_type: 3 } },
  }),
  false
);
assert.equal(Object.hasOwn(routeOverride, "showFlagTopic"), false);
let nativeCalls = 0;
const route = {
  currentUser: null,
  _super() {
    nativeCalls++;
    return "native";
  },
  modal: services.modal,
};
assert.equal(routeOverride.showFlags.call(route, eligible), "native");
route.currentUser = { id: 5 };
assert.equal(
  routeOverride.showFlags.call(route, { ...eligible, post_type: 3 }),
  "native"
);
assert.equal(
  routeOverride.showFlags.call(route, {
    ...eligible,
    topic: { archetype: "private_message" },
  }),
  "native"
);
assert.equal(nativeCalls, 3);
settings.isbf_severe_reports_enabled = false;
assert.equal(routeOverride.showFlags.call(route, eligible), undefined);
assert.equal(shown.at(-1)[0], SevereModal);
assert.equal(shown.at(-1)[1].model.canSevereReport(), false);
broadcast({ post_id: 22, hidden: true });
assert.equal(helper.isReportedHidden(22), true);
assert.equal(eligible.isbf_severe_report_pending, true);
broadcast({ post_id: 22, hidden: false });
assert.equal(helper.isReportedHidden(22), false);
console.log(
  "Topic-button capability, guest/PM/system-event fallback, full-topic preservation and hide/restore broadcast OK"
);

modal.args.model.canSevereReport = () => false;
assert.equal(modal.canSevereReport, false);
modal.enterSevere();
assert.equal(modal.severeStep, false);
assert.equal(modal.severeSubmitEnabled, false);
modal.args.model.canSevereReport = () => true;
modal.enterSevere();
assert.equal(modal.severeReason, " 1234567890 ");
assert.equal(modal.severeConfirmed, true);
console.log(
  "Shared ordinary modal when disabled, authoritative Site capability, native hide pending isolation and severe state recovery OK"
);
