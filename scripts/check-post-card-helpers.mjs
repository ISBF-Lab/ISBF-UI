import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../javascripts/discourse/lib/post-card-helpers.js", import.meta.url),
  "utf8"
);
const context = vm.createContext({
  document: {
    createElement() {
      return {
        innerHTML: "",
        get textContent() {
          return this.innerHTML.replace(/<[^>]*>/g, "");
        },
      };
    },
  },
});
const helpers = new vm.SourceTextModule(source, { context });
await helpers.link((name) => {
  assert.equal(name, "discourse/models/composer");
  return new vm.SyntheticModule(
    ["default"],
    function () {
      this.setExport("default", { CREATE_TOPIC: "createTopic", OPEN: "open" });
    },
    { context }
  );
});
await helpers.evaluate();
const { compactNumber, plainText, postCardTitle, openQuotedRepost } =
  helpers.namespace;

assert.equal(plainText("<p> 校园\n  信息 </p>"), "校园 信息");
assert.equal(plainText(null), "");
assert.equal(compactNumber(0), "");
assert.equal(compactNumber("invalid"), "");
assert.equal(
  compactNumber(1234),
  new Intl.NumberFormat(undefined, { notation: "compact" }).format(1234)
);
assert.equal(postCardTitle("标题", null), null);
assert.equal(postCardTitle("标题", undefined), null);
assert.equal(postCardTitle("  校园   活动 ", "<p>校园 活动详情</p>"), null);
assert.equal(postCardTitle("校园活动完整标题", "<p>校园活动</p>"), null);
assert.equal(postCardTitle("独立标题", "<p>另一个正文</p>"), "独立标题");
assert.equal(postCardTitle("独立标题", ""), "独立标题");
assert.equal(postCardTitle("独立标题", "<p>   </p>"), "独立标题");
assert.equal(postCardTitle("图片标题", '<img src="photo.png">'), "图片标题");
assert.equal(postCardTitle("  ", "<p>正文</p>"), null);

const options = {
  currentUser: { id: 1 },
  topicId: 123,
  postNumber: 7,
  username: "student",
  cookedHtml: `<p>${"字".repeat(550)}</p>`,
  title: "原话题",
};
const model = (attrs) => ({
  ...attrs,
  set(key, value) {
    this[key] = value;
  },
});
let loginRoute;
let opened = 0;
const existing = model({ action: "reply", reply: "我的回复" });
const composer = {
  model: existing,
  async openNewTopic() {
    opened++;
  },
};
assert.equal(
  await openQuotedRepost({
    ...options,
    composer,
    currentUser: null,
    router: {
      transitionTo(route) {
        loginRoute = route;
      },
    },
  }),
  false
);
assert.equal(loginRoute, "login");
assert.equal(opened, 0);
assert.equal(existing.isbf_repost_source_topic_id, undefined);
assert.equal(await openQuotedRepost({ ...options, composer }), false);
assert.equal(existing.reply, "我的回复");
assert.equal(existing.isbf_repost_source_topic_id, undefined);

let received;
composer.openNewTopic = async ({ body, title }) => {
  received = { body, title };
  composer.model = model({
    action: "createTopic",
    composeState: "open",
    draftKey: "new_topic_2",
    reply: body,
  });
};
assert.equal(await openQuotedRepost({ ...options, composer }), true);
assert.equal(received.title, options.title);
assert.equal(
  received.body,
  `[quote="student, post:7, topic:123"]\n${"字".repeat(500)}\n[/quote]\n\n`
);
assert.equal(composer.model.isbf_repost_source_topic_id, 123);
assert.equal(existing.isbf_repost_source_topic_id, undefined);

// Clean native models may be reused when their draft key and contents change.
const reused = model({ action: "reply", draftKey: "topic_123", reply: "" });
composer.model = reused;
composer.openNewTopic = async ({ body }) => {
  Object.assign(reused, {
    action: "createTopic",
    composeState: "open",
    draftKey: "new_topic_3",
    reply: body,
  });
};
assert.equal(await openQuotedRepost({ ...options, composer }), true);
assert.equal(reused.isbf_repost_source_topic_id, 123);

for (const action of ["reply", "edit", "createTopic"]) {
  const cancelled = model({
    action,
    composeState: "open",
    draftKey: "existing_draft",
    reply: received.body,
    isbf_repost_source_topic_id: 999,
  });
  composer.model = cancelled;
  composer.openNewTopic = async () => {};
  assert.equal(await openQuotedRepost({ ...options, composer }), false);
  assert.equal(cancelled.isbf_repost_source_topic_id, 999);
}
for (const attrs of [
  {
    action: "reply",
    composeState: "open",
    draftKey: "new_topic_4",
    reply: received.body,
  },
  {
    action: "createTopic",
    composeState: "draft",
    draftKey: "new_topic_4",
    reply: received.body,
  },
  {
    action: "createTopic",
    composeState: "open",
    draftKey: "new_topic_4",
    reply: "other draft",
  },
]) {
  composer.openNewTopic = async () => {
    composer.model = model(attrs);
  };
  assert.equal(await openQuotedRepost({ ...options, composer }), false);
  assert.equal(composer.model.isbf_repost_source_topic_id, undefined);
}
console.log(
  "Post card title visibility, quoted post:7, truncation, login and native draft safety OK"
);
