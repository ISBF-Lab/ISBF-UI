import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const jobs = [];
const requests = [];
const observers = [];
const listeners = new Set();
let fail = false;
let omitted = false;
const document = {
  visibilityState: "visible",
  addEventListener: (_name, callback) => listeners.add(callback),
  removeEventListener: (_name, callback) => listeners.delete(callback),
};
const context = vm.createContext({
  document,
  setTimeout: (callback) => jobs.push(callback),
  IntersectionObserver: class {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      observers.push(this);
    }
    observe(element) {
      this.element = element;
    }
    disconnect() {
      this.disconnected = true;
    }
    emit(isIntersecting) {
      this.callback([{ isIntersecting }]);
    }
  },
});
const synthetic = (exports) =>
  new vm.SyntheticModule(
    Object.keys(exports),
    function () {
      for (const [name, value] of Object.entries(exports)) {
        this.setExport(name, value);
      }
    },
    { context }
  );
const tracker = new vm.SourceTextModule(
  readFileSync(
    new URL("../javascripts/discourse/lib/view-tracker.js", import.meta.url),
    "utf8"
  ),
  { context }
);
await tracker.link(() =>
  synthetic({
    ajax: async (endpoint, options) => {
      requests.push({ endpoint, options });
      if (fail) {
        throw new Error("offline");
      }
      return {
        counts: omitted
          ? {}
          : Object.fromEntries(
              Object.values(options.data)[0].map((id) => [id, 7])
            ),
      };
    },
  })
);
await tracker.evaluate();
const factory = tracker.namespace.createViewTracker;
const topicView = factory("/isbf/views/impressions", "topic_ids");
const postView = factory("/isbf/views/post-impressions", "post_ids");
const pump = async () => {
  assert.ok(jobs.length);
  await jobs.shift()();
  await Promise.resolve();
};
const first = postView(21, 9);
assert.equal(postView(21, 9), first);
const second = postView(22, 9);
await pump();
assert.deepEqual(await Promise.all([first, second]), [7, 7]);
assert.equal(requests[0].endpoint, "/isbf/views/post-impressions");
assert.deepEqual(Array.from(requests[0].options.data.post_ids), [21, 22]);
assert.equal(await postView(21, 9), 7);
assert.equal(jobs.length, 0);
const otherAccount = postView(21, 10);
await pump();
assert.equal(await otherAccount, 7);
const firstPost = topicView(21, 9);
await pump();
assert.equal(await firstPost, 7);
assert.equal(requests.at(-1).endpoint, "/isbf/views/impressions");
fail = true;
const failed = postView(23, 9);
await pump();
assert.equal(await failed, null);
fail = false;
const retry = postView(23, 9);
await pump();
assert.equal(await retry, 7);
omitted = true;
const forbidden = postView(24, 9);
await pump();
assert.equal(await forbidden, null);
omitted = false;
const batches = Array.from({ length: 51 }, (_, index) =>
  postView(100 + index, 9)
);
await pump();
assert.equal(requests.at(-1).options.data.post_ids.length, 50);
await pump();
assert.equal(requests.at(-1).options.data.post_ids.length, 1);
await Promise.all(batches);

class Component {
  constructor(args) {
    this.args = args;
  }
}
const componentSource = readFileSync(
  new URL(
    "../javascripts/discourse/components/isbf-topic-views.gjs",
    import.meta.url
  ),
  "utf8"
)
  .replace(/<template>[\s\S]*?<\/template>/g, "")
  .replace(/@service\s+\w+;\s*/g, "")
  .replace(/@(tracked|action)\s+/g, "");
const component = new vm.SourceTextModule(componentSource, { context });
await component.link(() =>
  synthetic({
    default: Component,
    tracked() {},
    action() {},
    service() {},
    i18n: (key) => key,
    themePrefix: (key) => key,
    compactNumber: (number) => String(number),
    recordVisibleView: topicView,
    recordVisiblePostView: postView,
  })
);
await component.evaluate();
const Views = component.namespace.default;
const makeView = (post) => {
  const view = new Views({ post });
  view.currentUser = { id: 9 };
  view.siteSettings = { isbf_views_enabled: true };
  view.onVisibilityChange = view.onVisibilityChange.bind(view);
  return view;
};
const article = {};
const element = { closest: () => article };
const reply = makeView({ id: 500, post_number: 2, post_type: 1 });
reply.observe(element);
const observer = observers.at(-1);
assert.equal(observer.element, article);
assert.equal(observer.options.rootMargin, "0px");
observer.emit(false);
assert.equal(jobs.length, 0);
document.visibilityState = "hidden";
observer.emit(true);
assert.equal(jobs.length, 0);
document.visibilityState = "visible";
for (const callback of listeners) {
  callback();
}
await pump();
assert.equal(reply.count, 7);
assert.equal(observer.disconnected, true);
assert.equal(listeners.size, 0);
assert.equal(requests.at(-1).options.data.post_ids[0], 500);

fail = true;
const failedReply = makeView({ id: 501, post_number: 3, post_type: 1 });
failedReply.observe(element);
const retryObserver = observers.at(-1);
retryObserver.emit(true);
await pump();
assert.equal(failedReply.count, null);
assert.equal(retryObserver.disconnected, undefined);
fail = false;
retryObserver.emit(false);
retryObserver.emit(true);
await pump();
assert.equal(failedReply.count, 7);
assert.equal(retryObserver.disconnected, true);

const guest = makeView({ id: 502, post_number: 4, post_type: 1 });
guest.currentUser = null;
const beforeGuest = observers.length;
guest.observe(element);
assert.equal(observers.length, beforeGuest);
const disabled = makeView({ id: 503, post_number: 5, post_type: 1 });
disabled.siteSettings.isbf_views_enabled = false;
disabled.observe(element);
assert.equal(observers.length, beforeGuest);
const op = makeView({ topic: { id: 504 }, post_number: 1, post_type: 1 });
op.observe(element);
observers.at(-1).emit(true);
await pump();
assert.equal(requests.at(-1).endpoint, "/isbf/views/impressions");
assert.equal(requests.at(-1).options.data.topic_ids[0], 504);
assert.equal(jobs.length, 0);
console.log(
  "View batching, account isolation, visibility, retry and topic/reply routing OK"
);
