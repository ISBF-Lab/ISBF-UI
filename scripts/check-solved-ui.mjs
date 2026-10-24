import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const source = (path) => read(`javascripts/discourse/${path}`);
const context = vm.createContext({});
function synthetic(exports) {
  return new vm.SyntheticModule(
    Object.keys(exports),
    function () {
      for (const [name, value] of Object.entries(exports)) {
        this.setExport(name, value);
      }
    },
    { context }
  );
}
async function load(path, imports) {
  const text = source(path)
    .replace(/<template>[\s\S]*?<\/template>/g, "")
    .replace(/@service\s+\w+;\s*/g, "")
    .replace(/@action\s+/g, "");
  const module = new vm.SourceTextModule(text, { context });
  await module.link(imports);
  await module.evaluate();
  return module;
}
const scope = await load("lib/topic-card-scope.js", () => {});
class Component {
  constructor(args) {
    this.args = args;
  }
}
const common = {
  default: Component,
  action() {},
  service() {},
  themePrefix: (key) => key,
  i18n: (key, options) => `${key}${options ? `:${options.username}` : ""}`,
};
const linker = (name) =>
  name.endsWith("/topic-card-scope") ? scope : synthetic(common);
const factory = (await load("components/isbf-solved-action.gjs", linker))
  .namespace.default;
const Summary = (await load("components/isbf-solved-summary.gjs", linker))
  .namespace.default;
const router = { currentURL: "/t/campus/23" };
const settings = { solved_enabled: true, show_who_marked_solved: true };
function topic() {
  return {
    id: 23,
    archetype: "regular",
    accepted_answers: [],
    urlForPostNumber(number) {
      assert.equal(this.id, 23, "Native URL method retains topic context");
      return `/t/campus/${this.id}/${number}`;
    },
  };
}
function post(overrides = {}) {
  return {
    id: 71,
    post_number: 7,
    post_type: 1,
    can_accept_answer: true,
    accepted_answer: false,
    topic: topic(),
    ...overrides,
  };
}
// Ember's inherited @action descriptor binds methods to the component instance.
function nativeClass(methodName) {
  class NativeAction extends Component {
    saving = false;
    calls = 0;
    errors = [];
    events = [];

    get answerInfo() {
      return this.args.post.topic.accepted_answers.find(
        (answer) => answer.post_number === this.args.post.post_number
      );
    }
  }
  const boundActions = new WeakMap();
  Object.defineProperty(NativeAction.prototype, methodName, {
    get() {
      if (!boundActions.has(this)) {
        boundActions.set(
          this,
          async function () {
            const currentPost = this.args.post;
            this.calls++;
            this.saving = true;
            try {
              await this.request();
              const accepted = methodName === "acceptAnswer";
              currentPost.accepted_answer = accepted;
              currentPost.topic.accepted_answers = accepted
                ? [{ post_number: currentPost.post_number }]
                : [];
              this.events.push(currentPost);
            } catch (error) {
              this.errors.push(error);
            } finally {
              this.saving = false;
            }
          }.bind(this)
        );
      }
      return boundActions.get(this);
    },
  });
  return NativeAction;
}
const Accept = nativeClass("acceptAnswer");
const Unaccept = nativeClass("unacceptAnswer");
assert.equal(factory(Accept), factory(Accept));
assert.notEqual(factory(Accept), factory(Unaccept));
for (const invalid of [null, undefined, {}, "legacy"]) {
  assert.equal(factory(invalid), null);
}
function action(Native, currentPost = post(), state = {}) {
  const instance = new (factory(Native))({ post: currentPost, state });
  instance.router = router;
  instance.siteSettings = settings;
  instance.request = async () => {};
  return instance;
}
const accepting = action(Accept);
assert.equal(accepting.enabled, true);
assert.equal(accepting.canAct, true);
assert.equal(accepting.nativeAction, accepting.acceptAnswer);
assert.equal(accepting.label, "isbf_v2.solved_accept");
assert.equal(factory(Accept).hidden(), false);
let finishRequest;
accepting.request = () => new Promise((resolve) => (finishRequest = resolve));
const pending = accepting.runNativeAction();
assert.equal(accepting.saving, true);
await accepting.runNativeAction();
assert.equal(accepting.calls, 1, "In-flight native actions cannot duplicate");
finishRequest();
await pending;
assert.equal(accepting.saving, false);
assert.equal(accepting.args.post.accepted_answer, true);
assert.equal(accepting.events[0], accepting.args.post);
const failed = action(Accept);
const failure = new Error("Native request failed");
failed.request = async () => {
  throw failure;
};
await failed.runNativeAction();
assert.equal(failed.args.post.accepted_answer, false);
assert.deepEqual(failed.args.post.topic.accepted_answers, []);
assert.equal(failed.saving, false);
assert.equal(failed.errors[0], failure);
assert.equal(failed.events.length, 0);
const failedCancellationPost = post({ accepted_answer: true });
failedCancellationPost.topic.accepted_answers = [{ post_number: 7 }];
const failedCancellation = action(Unaccept, failedCancellationPost);
failedCancellation.request = async () => {
  throw failure;
};
await failedCancellation.runNativeAction();
assert.equal(failedCancellationPost.accepted_answer, true);
assert.deepEqual(failedCancellationPost.topic.accepted_answers, [
  { post_number: 7 },
]);
assert.equal(failedCancellation.saving, false);
assert.equal(failedCancellation.errors[0], failure);
const missingAction = action(class MissingNativeAction extends Component {});
assert.equal(missingAction.enabled, true);
assert.equal(missingAction.canAct, false);
await missingAction.runNativeAction();
const acceptedPost = post({ accepted_answer: true });
acceptedPost.topic.accepted_answers = [
  { post_number: 7, accepter_username: "teacher" },
];
const unaccepting = action(Unaccept, acceptedPost);
assert.equal(unaccepting.nativeAction, unaccepting.unacceptAnswer);
assert.equal(unaccepting.title, "isbf_v2.solved_accepted_by:teacher");
const readonly = action(
  Unaccept,
  post({
    accepted_answer: true,
    can_accept_answer: false,
  })
);
assert.equal(readonly.enabled, true);
assert.equal(readonly.canAct, false);
await readonly.runNativeAction();
assert.equal(readonly.calls, 0);
for (const excluded of [
  { post: post({ can_accept_answer: false }) },
  { post: post({ post_number: 1 }) },
  { post: post({ post_type: 2 }) },
  { post: post({ topic: { ...topic(), archetype: "private_message" } }) },
  { post: post({ topic: { ...topic(), is_nested_view: true } }) },
  { state: { nestedReplyView: true } },
  { path: "/admin" },
  { path: "/latest" },
  { settings: { solved_enabled: false } },
]) {
  router.currentURL = excluded.path ?? "/t/campus/23";
  const instance = action(Accept, excluded.post ?? post(), excluded.state);
  instance.siteSettings = excluded.settings ?? settings;
  assert.equal(instance.enabled, false);
  await instance.runNativeAction();
  assert.equal(instance.calls, 0);
}
router.currentURL = "/t/campus/23";
for (const flag of ["isDestroying", "isDestroyed"]) {
  const instance = action(Accept);
  instance[flag] = true;
  await instance.runNativeAction();
  assert.equal(instance.calls, 0);
}
function summary(currentPost, decoratorState = {}) {
  const instance = new Summary({ post: currentPost, decoratorState });
  instance.router = router;
  instance.siteSettings = settings;
  return instance;
}
const unavailableUrl = summary(
  post({
    post_number: 1,
    topic: {
      ...topic(),
      accepted_answers: [{ post_number: 7 }],
      urlForPostNumber: undefined,
    },
  })
);
assert.equal(unavailableUrl.answerUrl, null);
assert.equal(unavailableUrl.enabled, false);
const first = post({ post_number: 1, topic: acceptedPost.topic });
const compact = summary(first);
assert.equal(compact.answerUrl, "/t/campus/23/7");
assert.equal(compact.enabled, true);
first.topic.accepted_answers[0].url = "/t/native-slug/23/7";
assert.equal(compact.answerUrl, "/t/native-slug/23/7");
first.topic.accepted_answers[0].url = "https://untrusted.example/answer";
assert.equal(compact.answerUrl, "/t/campus/23/7");
await unaccepting.runNativeAction();
assert.equal(acceptedPost.accepted_answer, false);
assert.equal(compact.answerUrl, null);
assert.equal(
  compact.enabled,
  false,
  "Cancellation removes summary immediately"
);
for (const answer of [{ post_number: 1 }, { post_number: "7" }, {}]) {
  const instance = summary(
    post({
      post_number: 1,
      topic: {
        ...topic(),
        accepted_answers: [answer],
      },
    })
  );
  assert.equal(instance.enabled, false);
}
for (const excluded of [
  { post: post() },
  { state: { nestedReplyView: true } },
  { topic: { archetype: "private_message" } },
  { topic: { is_nested_view: true } },
  { path: "/admin" },
  { disabled: true },
]) {
  router.currentURL = excluded.path ?? "/t/campus/23";
  const currentPost =
    excluded.post ??
    post({
      post_number: 1,
      topic: {
        ...topic(),
        ...excluded.topic,
        accepted_answers: [{ post_number: 7 }],
      },
    });
  const instance = summary(currentPost, excluded.state);
  if (excluded.disabled) {
    instance.siteSettings = { solved_enabled: false };
  }
  assert.equal(instance.enabled, false);
}
router.currentURL = "/t/campus/23";
const callbacks = new Map();
const placeholder = class NativePlaceholder {};
const initializer = await load(
  "api-initializers/isbf-topic-card.gjs",
  (name) => {
    if (name === "discourse/lib/api") {
      return synthetic({ apiInitializer: (callback) => callback });
    }
    if (name.endsWith("/topic-card-scope")) {
      return scope;
    }
    if (name.endsWith("/isbf-solved-action")) {
      return synthetic({ default: factory });
    }
    return synthetic({
      default: placeholder,
      ISBFTopicBookmark: placeholder,
      ISBFTopicLike: placeholder,
      ISBFTopicReply: placeholder,
      ISBFTopicRepost: placeholder,
    });
  }
);
initializer.namespace.default({
  container: {
    lookup: (name) => (name === "service:router" ? router : settings),
  },
  renderInOutlet() {},
  renderAfterWrapperOutlet() {},
  registerValueTransformer: (name, callback) => callbacks.set(name, callback),
});
assert.ok(
  Array.from(initializer.namespace.default.after).includes(
    "extend-for-solved-button"
  )
);
const buttons = callbacks.get("post-menu-buttons");
const buttonKeys = {
  REPLY: "reply",
  LIKE: "like",
  BOOKMARK: "bookmark",
  SHOW_MORE: "showMore",
};
const others = ["flag", "edit", "delete", "pluginAction"].map((key) => [
  key,
  class OtherNativeAction {},
]);
function menu(Native = Accept, overrides = {}) {
  const currentPost = overrides.post ?? post();
  const entries = [
    ["reply", placeholder],
    ...others,
    ["like", placeholder],
    ["bookmark", placeholder],
    ["showMore", placeholder],
    ...(Native === null ? [] : [["solved", Native]]),
  ];
  const nodes = new Map(entries);
  const dag = {
    entries: () => Array.from(nodes),
    add: (key, value) => nodes.set(key, value),
    delete: (key) => nodes.delete(key),
  };
  buttons({
    value: dag,
    context: {
      post: currentPost,
      state: overrides.state ?? {},
      buttonKeys,
    },
  });
  return { nodes, currentPost, entries };
}
const promoted = menu();
assert.equal(promoted.nodes.get("solved"), factory(Accept));
assert.equal(
  Array.from(promoted.nodes.keys()).filter((key) => key === "solved").length,
  1
);
assert.deepEqual(Array.from(promoted.nodes.keys()), [
  "isbfReply",
  "isbfRepost",
  "isbfLike",
  "isbfViews",
  "isbfBookmark",
  "solved",
  "showMore",
]);
assert.deepEqual(
  Array.from(scope.namespace.secondaryMenuFor(promoted.currentPost)),
  others
);
assert.equal(menu(Unaccept).nodes.get("solved"), factory(Unaccept));
for (const Native of [null, { legacy: true }]) {
  const fallback = menu(Native);
  assert.equal(fallback.nodes.has("solved"), false);
  assert.deepEqual(
    Array.from(scope.namespace.secondaryMenuFor(fallback.currentPost)),
    [...others, ...(Native === null ? [] : [["solved", Native]])]
  );
}
settings.solved_enabled = false;
const disabled = menu();
assert.equal(disabled.nodes.has("solved"), false);
assert.deepEqual(
  Array.from(scope.namespace.secondaryMenuFor(disabled.currentPost)),
  [...others, ["solved", Accept]]
);
settings.solved_enabled = true;
for (const excluded of [
  { post: post({ topic: { ...topic(), archetype: "private_message" } }) },
  { state: { nestedReplyView: true } },
  { path: "/admin" },
]) {
  router.currentURL = excluded.path ?? "/t/campus/23";
  const untouched = menu(Accept, excluded);
  assert.deepEqual(Array.from(untouched.nodes), untouched.entries);
}
const actionSource = source("components/isbf-solved-action.gjs");
const summarySource = source("components/isbf-solved-summary.gjs");
for (const text of [actionSource, summarySource]) {
  assert.doesNotMatch(text, /\b(?:ajax|fetch|XMLHttpRequest)\b|\/solution\//);
}
assert.match(actionSource, /extends NativeAction/);
assert.match(
  actionSource,
  /\{\{#if this\.accepted\}\}[\s\S]*?isbf-solved-action__status[\s\S]*?\{\{\/if\}\}\s*\{\{#if this\.canAct\}\}/
);
assert.match(actionSource, /@disabled=\{\{this\.saving\}\}/);
assert.match(summarySource, /href=\{\{this\.answerUrl\}\}/);
for (const locale of ["en", "zh_CN"]) {
  const text = read(`locales/${locale}.yml`);
  for (const key of [
    "accept",
    "unaccept",
    "accepted",
    "view_answer",
    "accepted_by",
  ]) {
    assert.match(text, new RegExp(`solved_${key}:\\s*"[^"\\n]+"`));
  }
}
const styles = read("stylesheets/solved.scss");
assert.match(read("common/common.scss"), /@import "solved";/);
assert.match(
  styles,
  /^body:has\(\.isbf-v2-shell--topic-feed-style\) #main-outlet \.isbf-topic-card/
);
assert.match(
  styles,
  /\.isbf-topic-card__article:has\(\.isbf-solved-summary\) \.accepted-answers\s*\{\s*display: none/
);
assert.match(
  styles,
  /\.isbf-solved-action__button\s*\{[\s\S]*?min-width: 44px;[\s\S]*?min-height: 44px;/
);
assert.match(
  styles,
  /@media \(width <= 600px\)[\s\S]*?repeat\(5, minmax\(0, 1fr\)\)[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?justify-self: end;/
);
assert.match(styles, /flex-wrap: wrap;/);
assert.doesNotMatch(
  styles,
  /\.isbf-topic-card__more-menu|#[\da-f]{3,8}\b|rgb\(/i
);
process.stdout.write(
  "Solved native delegation, guards, updates, promotion, locale and responsive contracts OK\n"
);
