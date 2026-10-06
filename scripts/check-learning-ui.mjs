import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const context = vm.createContext({});
const composer = new vm.SourceTextModule(
  read("javascripts/discourse/lib/learning-composer.js"),
  { context },
);
const resources = new vm.SourceTextModule(
  read("javascripts/discourse/lib/learning-resources.js"),
  { context },
);
await composer.link(() => {});
await resources.link(() => {});
await composer.evaluate();
await resources.evaluate();
const {
  isLearningComposer,
  learningFileIds,
  learningPayload,
  restoreLearning,
} = composer.namespace;
const { learningConfig, learningResourceQuery, learningSafeUrl } =
  resources.namespace;
const courseId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";
const otherFileId = "33333333-3333-4333-8333-333333333333";
const config = {
  category_id: 10,
  grades: [1, 2, 3, 4].map((id) => ({ id, label: `Year ${id}` })),
};
const model = (values = {}) => ({
  site: { isbf_learning: config },
  categoryId: config.category_id,
  creatingTopic: true,
  ...values,
  set(key, value) {
    this[key] = value;
  },
});

assert.equal(learningConfig({ isbf_learning: config }), config);
assert.equal(learningConfig({}), null);
assert.equal(
  learningConfig({ isbf_learning: { ...config, category_id: 0 } }),
  null,
);
assert.equal(isLearningComposer(model()), true);
assert.equal(
  isLearningComposer(
    model({
      creatingTopic: false,
      editingPost: true,
      post: { post_number: 1 },
    }),
  ),
  true,
);
for (const excluded of [
  model({ site: {} }),
  model({ categoryId: 11 }),
  model({ creatingTopic: false }),
  model({ creatingTopic: false, editingPost: true, post: { post_number: 2 } }),
  model({ creatingTopic: false, editingPost: false, post: { post_number: 1 } }),
  model({
    creatingTopic: false,
    replyingToPost: true,
    post: { post_number: 1 },
  }),
]) {
  assert.equal(
    isLearningComposer(excluded),
    false,
    "Replies must not inherit learning metadata",
  );
  assert.equal(learningPayload(excluded, "isbf_learning_course_id"), undefined);
  assert.equal(learningPayload(excluded, "isbf_learning_files"), undefined);
  const before = { ...excluded };
  restoreLearning(excluded, {
    isbf_learning_course_id: courseId,
    isbf_learning_files: [fileId],
  });
  assert.deepEqual(excluded, before, "Excluded composers must not be hydrated");
}

const fresh = model({ isbf_anonymous: true });
restoreLearning(fresh, {
  isbf_learning_course_id: courseId,
  isbf_learning_files: [fileId, fileId, "invalid"],
});
assert.equal(fresh.isbf_learning_course_id, courseId);
assert.equal(fresh.isbf_learning_files, JSON.stringify([fileId]));
assert.equal(fresh.isbf_anonymous, false);
assert.equal(learningPayload(fresh, "isbf_learning_course_id"), courseId);
assert.equal(
  learningPayload(fresh, "isbf_learning_files"),
  JSON.stringify([fileId]),
);
const draft = model({
  isbf_learning_course_id: courseId,
  isbf_learning_files: JSON.stringify([fileId]),
});
restoreLearning(draft);
assert.equal(draft.isbf_learning_course_id, courseId);
assert.equal(draft.isbf_learning_files, JSON.stringify([fileId]));
restoreLearning(draft, {
  isbf_learning_course_id: "",
  isbf_learning_files: "[]",
});
assert.equal(
  draft.isbf_learning_course_id,
  "",
  "Explicit empty selections must replace drafts",
);
assert.equal(draft.isbf_learning_files, "[]");
const edited = model({
  creatingTopic: false,
  editingPost: true,
  post: { post_number: 1 },
});
restoreLearning(edited, {
  post: {
    isbf_learning_course_id: courseId,
    isbf_learning_files: [otherFileId],
  },
});
assert.equal(edited.isbf_learning_course_id, courseId);
assert.equal(edited.isbf_learning_files, JSON.stringify([otherFileId]));
assert.deepEqual(plain(learningFileIds("bad JSON")), []);
assert.deepEqual(plain(learningFileIds({ id: fileId })), []);
assert.deepEqual(plain(learningFileIds([fileId, fileId, "bad", null])), [
  fileId,
]);
const manyIds = Array.from(
  { length: 25 },
  (_, index) => `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
);
assert.equal(learningFileIds(manyIds).length, 20);
assert.deepEqual(plain(learningResourceQuery(courseId, " campus ", 2)), {
  q: "campus",
  page: 2,
});
assert.deepEqual(plain(learningResourceQuery(courseId, " ", 0)), {
  course_id: courseId,
  page: 0,
});
for (const url of [
  "/isbf/learning/files/token",
  "https://example.edu/file",
  "http://example.edu/file",
]) {
  assert.equal(learningSafeUrl(url), url);
}
for (const url of [
  null,
  10,
  "",
  "//example.edu/file",
  "/\\example.edu/file",
  "javascript:alert(1)",
  "data:text/html,x",
  "ftp://example.edu/file",
  " https://example.edu/file",
]) {
  assert.equal(learningSafeUrl(url), null, `Unsafe URL accepted: ${url}`);
}

class UploadPreProcessorPlugin {
  constructor(uppy, options) {
    this.uppy = uppy;
    this.opts = options;
  }

  _install(process) {
    this.installed = process;
  }

  _uninstall(process) {
    assert.equal(this.installed, process);
    this.installed = null;
  }

  _emitAllComplete(ids, complete) {
    return { ids, complete };
  }
}
const getUrl = new vm.SyntheticModule(
  ["default"],
  function () {
    this.setExport("default", (path) => `/forum${path}`);
  },
  { context },
);
const uploadBase = new vm.SyntheticModule(
  ["UploadPreProcessorPlugin"],
  function () {
    this.setExport("UploadPreProcessorPlugin", UploadPreProcessorPlugin);
  },
  { context },
);
const upload = new vm.SourceTextModule(
  read("javascripts/discourse/lib/learning-upload.js"),
  { context },
);
await upload.link((specifier) => {
  if (specifier === "discourse/lib/get-url") {
    return getUrl;
  }
  if (specifier === "discourse/lib/uppy-plugin-base") {
    return uploadBase;
  }
  if (specifier === "./learning-composer") {
    return composer;
  }
  throw new Error(`Unexpected upload dependency: ${specifier}`);
});
await upload.evaluate();
const LearningUpload = upload.namespace.default;
const nativeEndpoint = "/forum/uploads.json";
const uploader = {
  opts: { endpoint: nativeEndpoint },
  setOptions(options) {
    Object.assign(this.opts, options);
  },
};
let transport = uploader;
const uppy = {
  getPlugin(name) {
    assert.equal(name, "XHRUpload");
    return transport;
  },
};
const uploadModel = model({ isbf_learning_course_id: courseId });
const preprocessor = new LearningUpload(uppy, { composerModel: uploadModel });
preprocessor.install();
assert.equal(typeof preprocessor.installed, "function");
assert.deepEqual(preprocessor.process(["local-file"]), {
  ids: ["local-file"],
  complete: true,
});
assert.equal(uploader.opts.endpoint, "/forum/isbf/learning/uploads.json");
uploadModel.categoryId = 11;
preprocessor.process(["native-file"]);
assert.equal(
  uploader.opts.endpoint,
  nativeEndpoint,
  "Leaving learning must restore native uploads",
);
uploadModel.categoryId = config.category_id;
preprocessor.process(["second-learning-file"]);
assert.equal(uploader.opts.endpoint, "/forum/isbf/learning/uploads.json");
uploadModel.creatingTopic = false;
uploadModel.post = { post_number: 1 };
preprocessor.process(["reply-file"]);
assert.equal(
  uploader.opts.endpoint,
  nativeEndpoint,
  "Reply attachments must use native transport",
);
uploadModel.creatingTopic = true;
uploadModel.isbf_learning_course_id = "";
assert.throws(() => preprocessor.process(["no-course"]), /课程/);
transport = null;
uploadModel.isbf_learning_course_id = courseId;
assert.throws(
  () => preprocessor.process(["missing-transport"]),
  /authenticated upload transport/,
);
uploadModel.categoryId = 11;
assert.doesNotThrow(() => preprocessor.process(["native-without-xhr"]));
preprocessor.uninstall();
assert.equal(preprocessor.installed, null);

const initializer = read(
  "javascripts/discourse/api-initializers/isbf-learning.gjs",
);
for (const hook of [
  "serializeOnCreate",
  "serializeOnUpdate",
  "serializeToDraft",
  "addComposerUploadPreProcessor",
]) {
  assert.ok(
    initializer.includes(hook),
    `Learning initializer must register ${hook}`,
  );
}
console.log(
  "Learning composer scope, draft/edit hydration, payloads, safe URLs, all-library search and private upload transport OK",
);
