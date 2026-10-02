import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ crypto: { randomUUID } });
const source = readFileSync(
  new URL(
    "../javascripts/discourse/lib/optional-topic-title.js",
    import.meta.url
  ),
  "utf8"
);
const titles = new vm.SourceTextModule(source, { context });
await titles.link(() => {});
await titles.evaluate();
const {
  isUntitledTopicTitle,
  optionalTopicTitle,
  prepareOptionalTopicTitle,
  setOptionalTopicTitle,
} = titles.namespace;
const model = (attrs = {}) => ({
  ...attrs,
  setProperties(values) {
    Object.assign(this, values);
  },
});
const first = model({ title: "", reply: "正文不会成为标题" });
prepareOptionalTopicTitle(first);
assert.equal(isUntitledTopicTitle(first.title), true);
assert.equal(optionalTopicTitle(first.title), "");
assert.equal(first.isbf_optional_title, "");
assert.equal(first.title.includes(first.reply), false);
const original = first.title;
prepareOptionalTopicTitle(first);
assert.equal(first.title, original);
first.reply = "修改正文";
prepareOptionalTopicTitle(first);
assert.equal(first.title, original);
const second = model({ title: "" });
prepareOptionalTopicTitle(second);
assert.notEqual(first.title, second.title);
setOptionalTopicTitle(first, "自选标题");
assert.equal(first.title, "自选标题");
first.reply = "另一段正文";
prepareOptionalTopicTitle(first);
assert.equal(first.title, "自选标题");
setOptionalTopicTitle(first, "短");
assert.equal(first.title, "短");
setOptionalTopicTitle(first, "   ");
assert.equal(isUntitledTopicTitle(first.title), true);
assert.equal(first.isbf_optional_title, "   ");
const restored = model({
  title: first.title,
  isbf_optional_title: first.isbf_optional_title,
});
prepareOptionalTopicTitle(restored);
assert.equal(restored.title, first.title);
const legacy = model({ title: "旧草稿标题" });
prepareOptionalTopicTitle(legacy);
assert.equal(legacy.title, "旧草稿标题");
assert.equal(legacy.isbf_optional_title, "旧草稿标题");
const quote = model({ title: "原帖标题", reply: "[quote]原帖[/quote]" });
prepareOptionalTopicTitle(quote);
assert.equal(quote.title, "原帖标题");
assert.equal(isUntitledTopicTitle("校园动态"), false);
assert.equal(
  isUntitledTopicTitle("校园动态 [isbf-untitled:not-a-uuid]"),
  false
);
console.log(
  "Optional title, no body extraction, independent untitled identifiers, native manual validation input, draft restore and repost title OK"
);
