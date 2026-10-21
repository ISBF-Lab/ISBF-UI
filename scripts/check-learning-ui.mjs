import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const shared = {
  "isbf-learning": "isbf-resource-page",
  "isbf-learning-resource": "isbf-resource-item",
  "isbf-learning-share-dialog": "isbf-resource-share-dialog",
  "isbf-learning-grade-picker": "isbf-resource-parent-picker",
  "isbf-learning-course-dialog": "isbf-resource-directory-dialog",
};
const read = (path) => {
  const match = path.match(/components\/(.+)\.gjs$/);
  if (match && shared[match[1]]) {
    path = path.replace(match[1], shared[match[1]]);
  }
  return readFileSync(new URL(path, root), "utf8");
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const context = vm.createContext({});
const composer = new vm.SourceTextModule(
  read("javascripts/discourse/lib/learning-composer.js"),
  { context }
);
const resources = new vm.SourceTextModule(
  read("javascripts/discourse/lib/learning-resources.js"),
  { context }
);
await composer.link(() => {});
await resources.link(() => {});
await composer.evaluate();
await resources.evaluate();
const contentImages = new vm.SourceTextModule(
  read("javascripts/discourse/lib/content-images.js"),
  { context }
);
await contentImages.link((specifier) => {
  assert.equal(specifier, "discourse/lib/lightbox");
  return new vm.SyntheticModule(
    ["default", "sortLightboxItems"],
    function () {
      this.setExport("default", async () => {});
      this.setExport("sortLightboxItems", (items) => items);
    },
    { context }
  );
});
await contentImages.evaluate();
const { isImageAttachment } = contentImages.namespace;

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
for (const grades of [config.grades.slice(1), []]) {
  const remaining = { ...config, grades };
  assert.equal(
    learningConfig({ isbf_learning: remaining }),
    remaining,
    "A deleted parent must not disable course resources after a fresh login"
  );
}
for (const grades of [
  [config.grades[0], config.grades[0]],
  [{ id: 0, label: "Invalid" }],
  [null],
]) {
  assert.equal(learningConfig({ isbf_learning: { ...config, grades } }), null);
}
assert.equal(learningConfig({}), null);
const customCategories = {
  ...config,
  grades: [...config.grades, { id: 5, label: "General studies" }],
};
assert.equal(
  learningConfig({ isbf_learning: customCategories }),
  customCategories
);
assert.equal(
  learningConfig({ isbf_learning: { ...config, category_id: 0 } }),
  null
);
assert.equal(isLearningComposer(model()), true);
assert.equal(
  isLearningComposer(
    model({
      creatingTopic: false,
      editingPost: true,
      post: { post_number: 1 },
    })
  ),
  true
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
    "Replies must not inherit learning metadata"
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
  JSON.stringify([fileId])
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
  "Explicit empty selections must replace drafts"
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
  (_, index) => `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`
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
  // eslint-disable-next-line no-script-url
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
  { context }
);
const uploadBase = new vm.SyntheticModule(
  ["UploadPreProcessorPlugin"],
  function () {
    this.setExport("UploadPreProcessorPlugin", UploadPreProcessorPlugin);
  },
  { context }
);
const upload = new vm.SourceTextModule(
  read("javascripts/discourse/lib/learning-upload.js"),
  { context }
);
const marketplace = new vm.SourceTextModule(
  read("javascripts/discourse/lib/marketplace.js"),
  { context }
);
await marketplace.link(() => {});
await marketplace.evaluate();
const endpoint = new vm.SourceTextModule(
  read("javascripts/discourse/lib/private-upload-endpoint.js"),
  { context }
);
await endpoint.link((specifier) => {
  if (specifier === "discourse/lib/get-url") {
    return getUrl;
  }
  if (specifier === "./learning-composer") {
    return composer;
  }
  if (specifier === "./marketplace") {
    return marketplace;
  }
  throw new Error(`Unexpected endpoint dependency: ${specifier}`);
});
await endpoint.evaluate();
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
  if (specifier === "./private-upload-endpoint") {
    return endpoint;
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
  "Leaving learning must restore native uploads"
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
  "Reply attachments must use native transport"
);
uploadModel.creatingTopic = true;
uploadModel.isbf_learning_course_id = "";
assert.throws(() => preprocessor.process(["no-course"]), /课程/);
transport = null;
uploadModel.isbf_learning_course_id = courseId;
assert.throws(() => preprocessor.process(["missing-transport"]), /私有上传/);
uploadModel.categoryId = 11;
assert.doesNotThrow(() => preprocessor.process(["native-without-xhr"]));
preprocessor.uninstall();
assert.equal(preprocessor.installed, null);

uploadModel.site.isbf_marketplace = {
  category_id: 29,
  private_images: true,
  version: 1,
};
transport = uploader;
uploadModel.categoryId = 29;
endpoint.namespace.configurePrivateUploadEndpoint(uppy, uploadModel);
preprocessor.process(["market-image"]);
assert.equal(uploader.opts.endpoint, "/forum/isbf/marketplace/uploads.json");
uploadModel.categoryId = config.category_id;
endpoint.namespace.configurePrivateUploadEndpoint(uppy, uploadModel);
preprocessor.process(["learning-image"]);
assert.equal(uploader.opts.endpoint, "/forum/isbf/learning/uploads.json");
uploadModel.categoryId = 11;
endpoint.namespace.configurePrivateUploadEndpoint(uppy, uploadModel);
preprocessor.process(["ordinary-image"]);
assert.equal(uploader.opts.endpoint, nativeEndpoint);

const initializer = read(
  "javascripts/discourse/api-initializers/isbf-learning.gjs"
);
for (const hook of [
  "serializeOnCreate",
  "serializeOnUpdate",
  "serializeToDraft",
  "addComposerUploadPreProcessor",
]) {
  assert.ok(
    initializer.includes(hook),
    `Learning initializer must register ${hook}`
  );
}
function componentClass(path, globals = {}) {
  const source = read(`javascripts/discourse/components/${path}.gjs`);
  const className = source.match(/export default class (\w+)/)[1];
  const body = source
    .slice(
      source.indexOf("export default class"),
      source.indexOf("  <template>")
    )
    .replace("export default class", "class")
    .replace(/@service (\w+);/g, "$1 = services.$1;")
    .replace(/@tracked /g, "")
    .replace(/  @action\r?\n/g, "");
  return vm.runInNewContext(`${body}}\n${className}`, {
    Component: class {
      constructor(args = {}) {
        this.args = args;
      }

      willDestroy() {}
    },
    URL,
    Intl,
    dUniqueId: () => "learning-test-form",
    services: {},
    themePrefix: (key) => key,
    i18n: (key) => key,
    ...globals,
  });
}

const workbenchSource = read(
  "javascripts/discourse/components/isbf-v2-workbench.gjs"
);
const workbenchCards = vm.runInNewContext(
  workbenchSource.match(/const CARDS = (\[[\s\S]*?\n\]);/)[1]
);
const Workbench = componentClass("isbf-v2-workbench", {
  CARDS: workbenchCards,
  ...resources.namespace,
  alumniConfig: () => true,
  marketplaceConfig: () => true,
  careersConfig: () => false,
  teamupConfig: () => true,
  services: {
    site: { isbf_learning: config },
    siteSettings: { isbf_resume_enabled: true },
  },
});
const cards = new Workbench().cards;
assert.deepEqual(plain(cards.map((card) => card.key)), [
  "learning_resources",
  "library",
  "courses",
  "careers",
  "resume",
  "campus_services",
  "student_identity",
  "alumni",
  "marketplace",
  "teamup",
]);
assert.equal(cards[0].href, "/isbf/learning");
assert.equal(
  cards[1].href,
  null,
  "the library retains its current availability"
);
assert.equal(cards[8].href, "/isbf/marketplace");
assert.equal(cards[9].href, "/isbf/teamup");
assert.match(workbenchSource, /{{#each this\.cards as \|card\|}}/);
for (const [locale, title, search] of [
  ["zh_CN", "课程资源", "搜索全部课程资源"],
  ["en", "Course resources", "Search all course resources"],
]) {
  const text = read(`locales/${locale}.yml`);
  assert.ok(text.includes(`workbench_learning_resources: "${title}"`));
  assert.ok(text.includes(`learning_search: "${search}"`));
  assert.doesNotMatch(
    text.replace(
      /^.*learning_(?:wps_collection|collection_invitation):.*\r?\n/gm,
      ""
    ),
    /学习资源|学习资料|[Ll]earning resources?/
  );
}

let completeSubmission;
let rejectSubmission;
let submissions = [];
const ShareDialog = componentClass("isbf-learning-share-dialog", {
  ...resources.namespace,
  ajax: (url, options) => {
    submissions.push({ url, ...options });
    return new Promise((resolve, reject) => {
      completeSubmission = resolve;
      rejectSubmission = reject;
    });
  },
});
const submitted = [];
let closed = 0;
const makeDialog = () => {
  const dialog = new ShareDialog({
    course: { id: courseId, name: "Economics" },
    onClose: () => closed++,
    onSubmitted: (response) => submitted.push(response),
  });
  dialog.site = { isbf_learning: { resource_description: true } };
  dialog.siteSettings = {
    min_topic_title_length: 5,
    max_topic_title_length: 80,
  };
  dialog.description = "Useful notes\nSecond line";
  dialog.title = " Resource title ";
  dialog.link = " https://example.edu/resource ";
  return dialog;
};
const form = makeDialog();
for (const link of [
  // eslint-disable-next-line no-script-url
  "javascript:alert(1)",
  "/t/resource/1",
  "https://user:password@example.edu/",
  "https://",
  "https://example.edu/a b",
  "https://example.edu/\\file",
  `https://example.edu/${"a".repeat(2048)}`,
]) {
  form.link = link;
  assert.equal(form.saveDisabled, true, `Invalid form URL accepted: ${link}`);
}
form.link = " https://example.edu/resource ";
form.title = "tiny";
assert.equal(form.saveDisabled, true);
form.title = "a".repeat(81);
assert.equal(form.saveDisabled, true);
form.title = " Resource title ";
assert.equal(form.saveDisabled, false);
form.description = "😀".repeat(300);
assert.equal(form.saveDisabled, false, "300 Unicode code points are allowed");
form.description += "😀";
assert.equal(
  form.saveDisabled,
  true,
  "301 Unicode code points exceed the limit"
);
form.site.isbf_learning.resource_description = false;
assert.equal(
  form.saveDisabled,
  false,
  "Old backend does not validate hidden fields"
);
form.site.isbf_learning.resource_description = true;
form.description = "Useful notes\nSecond line";
const submitEvent = { preventDefault() {} };
let saving = form.save(submitEvent);
await form.save(submitEvent);
assert.equal(
  submissions.length,
  1,
  "Repeated submit must not send a second POST"
);
assert.deepEqual(plain(submissions[0]), {
  url: "/isbf/learning/resources",
  type: "POST",
  data: {
    course_id: courseId,
    title: "Resource title",
    link: "https://example.edu/resource",
    description: "Useful notes\nSecond line",
  },
});
rejectSubmission({ jqXHR: { responseJSON: { errors: ["Please retry"] } } });
await saving;
assert.equal(form.error, "Please retry");
assert.equal(form.saving, false);
assert.equal(form.title, " Resource title ");
assert.equal(form.link, " https://example.edu/resource ");
assert.equal(form.description, "Useful notes\nSecond line");
saving = form.save(submitEvent);
completeSubmission({ success: true });
await saving;
assert.equal(form.saving, false);
assert.equal(submitted.length, 0, "Malformed success must allow a retry");
saving = form.save(submitEvent);
completeSubmission({ success: true, pending: true });
await saving;
assert.deepEqual(plain(submitted), [{ success: true, pending: true }]);
const dismissed = makeDialog();
saving = dismissed.save(submitEvent);
dismissed.close();
completeSubmission({ success: true, pending: false });
await saving;
assert.equal(closed, 1);
assert.equal(submitted.length, 1, "Closed form must ignore late success");
const destroyed = makeDialog();
saving = destroyed.save(submitEvent);
destroyed.willDestroy();
rejectSubmission(new Error("Late failure"));
await saving;
assert.equal(destroyed.error, null, "Destroyed form must ignore late errors");

const contributorForm = makeDialog();
contributorForm.site.isbf_learning.resource_contributor = true;
contributorForm.site.isbf_learning.resource_admin_management = true;
contributorForm.currentUser = { name: "😀".repeat(20), username: "username" };
assert.equal(contributorForm.contributorValue, "😀".repeat(20));
assert.equal(
  contributorForm.saveDisabled,
  false,
  "Default display names are not constrained"
);
assert.equal(contributorForm.shareLabel, "isbf_v2.learning_apply_share");
assert.equal(contributorForm.submitLabel, "isbf_v2.learning_submit_request");
contributorForm.currentUser.moderator = true;
assert.equal(
  contributorForm.shareLabel,
  "isbf_v2.learning_apply_share",
  "Moderators also apply"
);
contributorForm.currentUser.admin = true;
assert.equal(contributorForm.shareLabel, "isbf_v2.learning_share");
assert.equal(contributorForm.submitLabel, "isbf_v2.learning_share");
contributorForm.currentUser.admin = false;
contributorForm.changeContributor({ target: { value: "😀".repeat(15) } });
assert.equal(contributorForm.saveDisabled, false);
contributorForm.changeContributor({ target: { value: "😀".repeat(16) } });
assert.equal(contributorForm.saveDisabled, true);
contributorForm.site.isbf_learning.resource_contributor = false;
assert.equal(
  contributorForm.saveDisabled,
  false,
  "Unsupported fields cannot block submit"
);
contributorForm.site.isbf_learning.resource_contributor = true;
contributorForm.changeContributor({ target: { value: "  Contributor  " } });
saving = contributorForm.save(submitEvent);
assert.equal(submissions.at(-1).data.contributor, "Contributor");
rejectSubmission(new Error("Retry"));
await saving;
assert.equal(contributorForm.contributorValue, "  Contributor  ");
contributorForm.changeContributor({ target: { value: "   " } });
saving = contributorForm.save(submitEvent);
assert.equal(
  submissions.at(-1).data.contributor,
  "",
  "Blank uses backend display name fallback"
);
completeSubmission({ success: true, pending: true });
await saving;
const defaultContributorForm = makeDialog();
defaultContributorForm.site.isbf_learning.resource_contributor = true;
defaultContributorForm.currentUser = {
  name: "Long display name beyond the limit",
};
saving = defaultContributorForm.save(submitEvent);
assert.equal(
  submissions.at(-1).data.contributor,
  "",
  "Unedited defaults are resolved by backend"
);
completeSubmission({ success: true, pending: false });
await saving;

const editableResource = {
  id: 42,
  link_only: true,
  files: [],
  course: { id: courseId, name: "Economics" },
  description: "List excerpt must not overwrite the full description",
  contributor: "List contributor must not overwrite the post",
};
const editTopic = {
  id: 42,
  title: "Original resource title",
  post_stream: {
    posts: [
      { id: 91, post_number: 2 },
      { id: 90, post_number: 1 },
    ],
  },
};
const editPost = {
  id: 90,
  topic_id: 42,
  post_number: 1,
  can_edit: true,
  raw: "Existing raw body",
  name: "Original author",
  username: "original-author",
  isbf_learning_course_id: courseId,
  isbf_learning_files: [],
  isbf_learning_link: "https://example.edu/original",
  isbf_learning_description:
    "Full description\nSecond line with original context",
  isbf_learning_contributor: "Original contributor",
};
const { learningEditableResource, learningEditDetails, learningLinkBody } =
  resources.namespace;
assert.equal(learningEditableResource(editableResource), true);
for (const change of [
  { id: "42" },
  { id: 0 },
  { link_only: false },
  { link_only: "true" },
  { files: undefined },
  { files: null },
  { files: [fileId] },
]) {
  assert.equal(
    learningEditableResource({ ...editableResource, ...change }),
    false
  );
}
assert.equal(learningEditDetails(editTopic, editPost, courseId).postId, 90);
for (const change of [
  { can_edit: false },
  { can_edit: "true" },
  { can_edit: undefined },
  { id: 91 },
  { topic_id: 43 },
  { post_number: 2 },
  { isbf_learning_course_id: "another-course" },
  { isbf_learning_files: undefined },
  { isbf_learning_files: "[]" },
  { isbf_learning_files: [fileId] },
  { isbf_learning_link: "" },
  { isbf_learning_description: {} },
  { isbf_learning_contributor: [] },
]) {
  assert.equal(
    learningEditDetails(editTopic, { ...editPost, ...change }, courseId),
    null
  );
}
assert.equal(learningEditDetails(editTopic, editPost, "another-course"), null);
assert.equal(
  learningEditDetails(
    { ...editTopic, post_stream: { posts: [] } },
    editPost,
    courseId
  ),
  null
);
assert.equal(
  learningEditDetails(
    editTopic,
    { ...editPost, isbf_learning_contributor: null },
    courseId
  ).contributor,
  "Original author"
);
const escapedBody = learningLinkBody(
  "[Title] <script>",
  "https://example.edu/a",
  "<img> **text**\r\nSecond line"
);
assert.ok(!escapedBody.includes("<script>") && !escapedBody.includes("<img>"));
assert.ok(
  escapedBody.includes("&lt;script&gt;") && escapedBody.includes("&lt;img&gt;")
);
assert.ok(escapedBody.includes("\nSecond line"));

const editRequests = [];
const editResults = [];
const resourceManager = {
  moderator: true,
  academy_moderator_permissions: {
    manage_resources: true,
    review_resources: false,
    edit_others: false,
  },
};
const usersWithoutResourceManagement = [
  null,
  {},
  { moderator: true },
  { academy_moderator_permissions: { manage_resources: false } },
  { academy_moderator_permissions: { review_resources: true } },
  { academy_moderator_permissions: { edit_others: true } },
];
const editServices = {
  currentUser: { admin: true, name: "Current administrator" },
  site: {
    isbf_learning: {
      resource_admin_management: true,
      resource_description: true,
      resource_contributor: true,
    },
  },
  siteSettings: { min_topic_title_length: 5, max_topic_title_length: 80 },
};
const EditDialog = componentClass("isbf-learning-share-dialog", {
  ...resources.namespace,
  services: editServices,
  ajax: (url, options) =>
    new Promise((resolve, reject) => {
      editRequests.push({ url, ...options, resolve, reject });
    }),
});
const makeEditDialog = () =>
  new EditDialog({
    course: editableResource.course,
    resource: editableResource,
    onClose() {},
    onSubmitted: (result) => editResults.push(result),
  });
const flushEdit = () => new Promise(setImmediate);
async function loadEdit(dialog, post = editPost) {
  const topicRequest = editRequests.at(-1);
  assert.equal(topicRequest.url, "/t/42.json");
  assert.equal(topicRequest.type, undefined, "Fresh topic reads use GET");
  assert.equal(
    dialog.saveDisabled,
    true,
    "Loading cannot submit incomplete fields"
  );
  topicRequest.resolve(editTopic);
  await flushEdit();
  const postRequest = editRequests.at(-1);
  assert.equal(postRequest.url, "/posts/90.json");
  assert.equal(postRequest.type, undefined, "Fresh first post reads use GET");
  postRequest.resolve(post);
  await flushEdit();
}
const editForm = makeEditDialog();
await loadEdit(editForm);
assert.equal(editForm.description, editPost.isbf_learning_description);
assert.equal(editForm.contributorValue, "Original contributor");
assert.equal(editForm.title, editTopic.title);
assert.equal(editForm.shareLabel, "isbf_v2.learning_edit");
assert.equal(editForm.submitLabel, "isbf_v2.learning_save_changes");
assert.equal(editForm.saveDisabled, false);
editForm.title = "Updated resource title";
editForm.link = "https://example.edu/updated";
editForm.description = "Updated description\nFull second line";
editForm.contributor = "Updated credit";
saving = editForm.save(submitEvent);
const firstEdit = editRequests.at(-1);
const requestsBeforeDuplicate = editRequests.length;
await editForm.save(submitEvent);
assert.equal(
  editRequests.length,
  requestsBeforeDuplicate,
  "Repeated edit submit sends one PUT"
);
assert.deepEqual(
  plain({ url: firstEdit.url, type: firstEdit.type, data: firstEdit.data }),
  {
    url: "/posts/90.json",
    type: "PUT",
    data: {
      title: "Updated resource title",
      post: {
        raw: learningLinkBody(
          editForm.title,
          editForm.link,
          editForm.description
        ),
        isbf_learning_link: editForm.link,
        isbf_learning_description: editForm.description,
        isbf_learning_contributor: editForm.contributor,
      },
    },
  }
);
assert.deepEqual(Object.keys(firstEdit.data).sort(), ["post", "title"]);
assert.deepEqual(
  Object.keys(firstEdit.data.post).sort(),
  [
    "isbf_learning_contributor",
    "isbf_learning_description",
    "isbf_learning_link",
    "raw",
  ],
  "Edit cannot mutate author, created time, course or files"
);
firstEdit.reject({ jqXHR: { responseJSON: { errors: ["Edit denied"] } } });
await saving;
assert.equal(editForm.error, "Edit denied");
assert.equal(editForm.saving, false);
assert.equal(editForm.description, "Updated description\nFull second line");
assert.equal(editForm.contributor, "Updated credit");
saving = editForm.save(submitEvent);
editRequests.at(-1).resolve({ post: { id: 91, topic_id: 42 } });
await saving;
assert.equal(editResults.length, 0, "Wrong post response allows retry");
saving = editForm.save(submitEvent);
editRequests.at(-1).resolve({ post: { id: 90, topic_id: 42 } });
await saving;
assert.deepEqual(plain(editResults), [
  { success: true, pending: false, edited: true },
]);
const requestsAfterSuccess = editRequests.length;
await editForm.save(submitEvent);
assert.equal(
  editRequests.length,
  requestsAfterSuccess,
  "Completed edit cannot resubmit"
);

const unchangedEdit = makeEditDialog();
await loadEdit(unchangedEdit);
saving = unchangedEdit.save(submitEvent);
assert.equal(
  editRequests.at(-1).data.post.raw,
  editPost.raw,
  "Unchanged edit retains existing raw body"
);
unchangedEdit.close();
editRequests.at(-1).resolve({ post: { id: 90, topic_id: 42 } });
await saving;
assert.equal(editResults.length, 1, "Cancelled edit ignores late save success");
const destroyedEdit = makeEditDialog();
await loadEdit(destroyedEdit);
saving = destroyedEdit.save(submitEvent);
destroyedEdit.willDestroy();
editRequests.at(-1).reject(new Error("Late edit failure"));
await saving;
assert.equal(destroyedEdit.error, null);
for (const abandon of ["close", "willDestroy"]) {
  const abandoned = makeEditDialog();
  const topicRead = editRequests.at(-1);
  const beforeClose = editRequests.length;
  abandoned[abandon]();
  topicRead.resolve(editTopic);
  await flushEdit();
  assert.equal(
    editRequests.length,
    beforeClose,
    "Abandoned topic load cannot fetch a post"
  );
  assert.equal(abandoned.editReady, false);
  const abandonedPost = makeEditDialog();
  editRequests.at(-1).resolve(editTopic);
  await flushEdit();
  const postRead = editRequests.at(-1);
  abandonedPost[abandon]();
  postRead.resolve(editPost);
  await flushEdit();
  assert.equal(
    abandonedPost.title,
    "",
    "Abandoned post load cannot hydrate a form"
  );
  assert.equal(abandonedPost.editReady, false);
}
const retryEdit = makeEditDialog();
editRequests.at(-1).reject(new Error("Temporary read failure"));
await flushEdit();
assert.equal(retryEdit.loading, false);
assert.ok(retryEdit.loadError);
retryEdit.retryLoad();
const requestsDuringLoad = editRequests.length;
await retryEdit.retryLoad();
assert.equal(
  editRequests.length,
  requestsDuringLoad,
  "Repeated retry sends one fresh GET"
);
await loadEdit(retryEdit);
assert.equal(retryEdit.editReady, true);
assert.equal(retryEdit.loadError, null);
retryEdit.currentUser = { moderator: true };
await retryEdit.save(submitEvent);
assert.equal(
  editRequests.length,
  requestsDuringLoad + 1,
  "Admin permission is rechecked at save"
);
for (const user of usersWithoutResourceManagement) {
  editServices.currentUser = user;
  const deniedBefore = editRequests.length;
  const deniedEdit = makeEditDialog();
  assert.equal(deniedEdit.editAllowed, false);
  await deniedEdit.save(submitEvent);
  assert.equal(
    editRequests.length,
    deniedBefore,
    "Editing requires the resource management grant"
  );
}
editServices.currentUser = { admin: true };
for (const deniedPost of [
  { ...editPost, can_edit: false },
  { ...editPost, isbf_learning_files: [fileId] },
  { ...editPost, isbf_learning_course_id: "different-course" },
]) {
  const deniedEdit = makeEditDialog();
  await loadEdit(deniedEdit, deniedPost);
  assert.equal(deniedEdit.editReady, false);
  assert.equal(deniedEdit.saveDisabled, true);
  assert.ok(deniedEdit.loadError);
}
const revokedLoad = makeEditDialog();
editRequests.at(-1).resolve(editTopic);
await flushEdit();
revokedLoad.currentUser = { moderator: true };
editRequests.at(-1).resolve(editPost);
await flushEdit();
assert.equal(
  revokedLoad.editReady,
  false,
  "Load completion rechecks administrator permission"
);
const longCredit = makeEditDialog();
await loadEdit(longCredit, {
  ...editPost,
  isbf_learning_contributor: "Original contributor beyond fifteen characters",
});
assert.equal(
  longCredit.saveDisabled,
  false,
  "Original legacy contributor remains valid"
);
longCredit.changeContributor({
  target: { value: "New contributor beyond fifteen characters" },
});
assert.equal(longCredit.saveDisabled, true);
const hiddenEditFields = makeEditDialog();
await loadEdit(hiddenEditFields);
hiddenEditFields.site = {
  isbf_learning: {
    resource_admin_management: true,
    resource_description: false,
    resource_contributor: false,
  },
};
hiddenEditFields.title = "Edited with hidden fields";
saving = hiddenEditFields.save(submitEvent);
const hiddenPut = editRequests.at(-1);
assert.equal(
  hiddenPut.data.post.raw,
  learningLinkBody(
    hiddenEditFields.title,
    editPost.isbf_learning_link,
    editPost.isbf_learning_description
  ),
  "Hidden description survives the rebuilt raw body"
);
assert.deepEqual(
  Object.keys(hiddenPut.data.post).sort(),
  ["isbf_learning_link", "raw"],
  "Unsupported custom fields remain untouched"
);
hiddenPut.reject(new Error("Retry edit"));
await saving;
assert.equal(hiddenEditFields.saving, false);

editServices.currentUser = resourceManager;
const delegatedEdit = makeEditDialog();
await loadEdit(delegatedEdit);
assert.equal(delegatedEdit.editAllowed, true);
assert.equal(delegatedEdit.editReady, true);
assert.equal(delegatedEdit.title, editTopic.title);
assert.equal(delegatedEdit.description, editPost.isbf_learning_description);
delegatedEdit.title = "Resource manager updated title";
saving = delegatedEdit.save(submitEvent);
assert.equal(editRequests.at(-1).type, "PUT");
assert.equal(editRequests.at(-1).url, "/posts/90.json");
editRequests.at(-1).reject({
  jqXHR: { responseJSON: { errors: ["Resource edit failed"] } },
});
await saving;
assert.equal(delegatedEdit.title, "Resource manager updated title");
assert.equal(delegatedEdit.error, "Resource edit failed");
saving = delegatedEdit.save(submitEvent);
editRequests.at(-1).resolve({ post: { id: 90, topic_id: 42 } });
await saving;
assert.equal(editResults.at(-1).edited, true);

const revokedManagerEdit = makeEditDialog();
await loadEdit(revokedManagerEdit);
revokedManagerEdit.currentUser = { moderator: true };
const beforeRevokedSave = editRequests.length;
await revokedManagerEdit.save(submitEvent);
assert.equal(editRequests.length, beforeRevokedSave);
assert.equal(revokedManagerEdit.saveDisabled, true);

const revokedManagerLoad = makeEditDialog();
editRequests.at(-1).resolve(editTopic);
await flushEdit();
revokedManagerLoad.currentUser = { moderator: true };
editRequests.at(-1).resolve(editPost);
await flushEdit();
assert.equal(revokedManagerLoad.editReady, false);
editServices.currentUser = { admin: true };

const deletions = [];
let completeDeletion;
let rejectDeletion;
const ResourceCard = componentClass("isbf-learning-resource", {
  ...resources.namespace,
  isImageAttachment,
  learningSafeUrl,
  learningFileSize: resources.namespace.learningFileSize,
  ajax: (url, options) => {
    deletions.push({ url, ...options });
    return new Promise((resolve, reject) => {
      completeDeletion = resolve;
      rejectDeletion = reject;
    });
  },
});
const card = new ResourceCard({
  resource: {
    url: "/t/native-topic/1",
    links: [
      "/local",
      "https://user@example.edu",
      "https://example.edu/resource",
    ],
    files: [
      { url: "/isbf/learning/files/token", name: "Legacy PDF", size: 1024 },
    ],
  },
});
assert.equal(card.titleUrl, "https://example.edu/resource");
assert.equal(card.additionalLinks.length, 1);
card.args.resource.link_only = true;
assert.equal(
  card.additionalLinks.length,
  0,
  "New cards must not repeat their title link"
);
assert.equal(card.files.length, 1, "Legacy attachments must remain accessible");
assert.equal(
  card.files[0].isImage,
  false,
  "non-image downloads retain their existing entry"
);
const attachmentCard = new ResourceCard({
  resource: {
    files: [
      { url: "/isbf/learning/files/photo", name: "课表.PNG", size: 2048 },
      {
        url: "/isbf/learning/files/animation",
        name: "diagram.gif",
        size: 4096,
      },
      { url: "/isbf/learning/files/document", name: "notes.pdf", size: 1024 },
      {
        url: "/isbf/learning/files/archive",
        name: "picture.png.zip",
        size: 1024,
      },
      // eslint-disable-next-line no-script-url
      { url: "javascript:alert(1)", name: "unsafe.jpg", size: 1024 },
    ],
  },
});
assert.deepEqual(
  plain(
    attachmentCard.files.map(({ name, url, isImage, sizeLabel }) => ({
      name,
      url,
      isImage,
      sizeLabel,
    }))
  ),
  [
    {
      name: "课表.PNG",
      url: "/isbf/learning/files/photo",
      isImage: true,
      sizeLabel: resources.namespace.learningFileSize(2048),
    },
    {
      name: "diagram.gif",
      url: "/isbf/learning/files/animation",
      isImage: true,
      sizeLabel: resources.namespace.learningFileSize(4096),
    },
    {
      name: "notes.pdf",
      url: "/isbf/learning/files/document",
      isImage: false,
      sizeLabel: resources.namespace.learningFileSize(1024),
    },
    {
      name: "picture.png.zip",
      url: "/isbf/learning/files/archive",
      isImage: false,
      sizeLabel: resources.namespace.learningFileSize(1024),
    },
  ],
  "image previews preserve safe download URLs and file sizes; unsafe URLs never render"
);

card.args.resource.links = [];
assert.equal(
  card.titleUrl,
  undefined,
  "File-only cards must not navigate to a topic"
);
assert.equal(card.contributor, "");
card.args.resource.author = { username: "legacy", name: "Legacy Author" };
assert.equal(card.contributor, "");
card.args.resource.author.name = "";
assert.equal(card.contributor, "");
card.args.resource.contributor = "<script>credit</script>";
assert.equal(card.contributor, "<script>credit</script>");
let deletedCards = 0;
const makeDeleteCard = () => {
  const resource = new ResourceCard({
    resource: { id: "resource-id", can_delete: true },
    onDeleted: () => deletedCards++,
  });
  resource.currentUser = { admin: true };
  resource.site = { isbf_learning: { resource_admin_management: true } };
  resource.dialog = { confirm: async () => true };
  return resource;
};
const deleteCard = makeDeleteCard();
for (const user of [{}, { moderator: true }, null]) {
  deleteCard.currentUser = user;
  assert.equal(deleteCard.canDelete, false);
  await deleteCard.deleteResource();
}
assert.equal(deletions.length, 0);
deleteCard.currentUser = { admin: true };
deleteCard.site.isbf_learning.resource_admin_management = false;
assert.equal(deleteCard.canDelete, false);
deleteCard.site.isbf_learning.resource_admin_management = true;
for (const permission of [false, undefined, "true"]) {
  deleteCard.args.resource.can_delete = permission;
  assert.equal(deleteCard.canDelete, false);
}
deleteCard.args.resource.can_delete = true;
deleteCard.dialog.confirm = async () => false;
await deleteCard.deleteResource();
assert.equal(deletions.length, 0, "Cancelled deletion makes no request");
assert.equal(deleteCard.deleting, false);
deleteCard.dialog.confirm = async () => true;
let deleting = deleteCard.deleteResource();
await new Promise(setImmediate);
await deleteCard.deleteResource();
assert.equal(deletions.length, 1, "Duplicate clicks send one DELETE");
assert.deepEqual(plain(deletions[0]), {
  url: "/isbf/learning/resources/resource-id",
  type: "DELETE",
});
rejectDeletion({ jqXHR: { responseJSON: { errors: ["Delete denied"] } } });
await deleting;
assert.equal(deleteCard.deleteError, "Delete denied");
assert.equal(deleteCard.deleting, false);
assert.equal(
  deleteCard.args.resource.id,
  "resource-id",
  "Failures retain card for retry"
);
assert.equal(deletedCards, 0, "Failures never remove cards optimistically");
deleting = deleteCard.deleteResource();
await new Promise(setImmediate);
completeDeletion({ success: false });
await deleting;
assert.equal(deleteCard.deleting, false);
assert.equal(deletedCards, 0);
deleting = deleteCard.deleteResource();
await new Promise(setImmediate);
completeDeletion({ success: true });
await deleting;
assert.equal(deletedCards, 1);
await deleteCard.deleteResource();
assert.equal(deletions.length, 3, "Successful deletion cannot repeat");
const revokedPermission = makeDeleteCard();
let confirmRevoked;
revokedPermission.dialog.confirm = () =>
  new Promise((resolve) => {
    confirmRevoked = resolve;
  });
deleting = revokedPermission.deleteResource();
revokedPermission.currentUser = { moderator: true };
confirmRevoked(true);
await deleting;
assert.equal(
  deletions.length,
  3,
  "Permissions are rechecked after confirmation"
);
const staleConfirmation = makeDeleteCard();
let confirmLater;
staleConfirmation.dialog.confirm = () =>
  new Promise((resolve) => {
    confirmLater = resolve;
  });
deleting = staleConfirmation.deleteResource();
staleConfirmation.willDestroy();
confirmLater(true);
await deleting;
assert.equal(
  deletions.length,
  3,
  "Navigation during confirmation cancels the request"
);
const staleDelete = makeDeleteCard();
deleting = staleDelete.deleteResource();
await new Promise(setImmediate);
staleDelete.willDestroy();
completeDeletion({ success: true });
await deleting;
assert.equal(deletedCards, 1, "Destroyed cards cannot reload another page");
const staleFailure = makeDeleteCard();
deleting = staleFailure.deleteResource();
await new Promise(setImmediate);
staleFailure.willDestroy();
rejectDeletion(new Error("Late error"));
await deleting;
assert.equal(staleFailure.deleteError, null);
const menuCard = makeDeleteCard();
const requestsBeforeMenu = deletions.length;
const menuEvents = [];
let finishMenuClose;
const closingMenu = {
  close: () => {
    menuEvents.push("closing");
    return new Promise((resolve) => {
      finishMenuClose = () => {
        menuEvents.push("closed");
        resolve();
      };
    });
  },
};
menuCard.dialog.confirm = async () => {
  menuEvents.push("confirm");
  return false;
};
const fromMenu = menuCard.deleteFromMenu(closingMenu);
await new Promise(setImmediate);
assert.deepEqual(menuEvents, ["closing"]);
finishMenuClose();
await fromMenu;
assert.deepEqual(menuEvents, ["closing", "closed", "confirm"]);
assert.equal(
  deletions.length,
  requestsBeforeMenu,
  "Menu cancellation makes no request"
);
const menuRevoked = makeDeleteCard();
const revokedMenuEvents = [];
menuRevoked.dialog.confirm = async () => {
  revokedMenuEvents.push("confirm");
  return true;
};
await menuRevoked.deleteFromMenu({
  close: async () => {
    menuRevoked.currentUser = { moderator: true };
  },
});
assert.deepEqual(revokedMenuEvents, []);
assert.equal(
  deletions.length,
  requestsBeforeMenu,
  "Menu close rechecks current permissions"
);
await menuRevoked.deleteFromMenu({
  close: async () => {
    throw new Error("Unauthorized users cannot operate the menu");
  },
});
assert.deepEqual(plain(menuCard.menuTriggers), ["click"]);
const makeEditCard = () => {
  const candidate = makeDeleteCard();
  candidate.args.resource = {
    ...editableResource,
    can_delete: true,
    can_edit: true,
  };
  return candidate;
};
const editCard = makeEditCard();
assert.equal(editCard.canEdit, true);
for (const change of [
  { link_only: false },
  { link_only: "true" },
  { files: [fileId] },
  { files: undefined },
]) {
  editCard.args.resource = {
    ...editableResource,
    can_delete: true,
    can_edit: true,
    ...change,
  };
  assert.equal(
    editCard.canEdit,
    true,
    "Managers can edit published legacy resources when the server grants editing"
  );
  assert.equal(
    editCard.canDelete,
    true,
    "Legacy resource deletion is preserved"
  );
}
editCard.args.resource = {
  ...editableResource,
  can_delete: true,
  can_edit: true,
};
for (const currentUser of usersWithoutResourceManagement) {
  editCard.currentUser = currentUser;
  assert.equal(editCard.canEdit, false);
}
const delegatedEditCard = makeEditCard();
delegatedEditCard.currentUser = resourceManager;
assert.equal(
  delegatedEditCard.canEdit,
  true,
  "Resource management includes editing link resources"
);
let delegatedOpened = false;
delegatedEditCard.args.onEdit = () => {
  delegatedOpened = true;
};
await delegatedEditCard.editFromMenu({ close: async () => {} });
assert.equal(delegatedOpened, true);
delegatedOpened = false;
await delegatedEditCard.editFromMenu({
  close: async () => {
    delegatedEditCard.currentUser = { moderator: true };
  },
});
assert.equal(
  delegatedOpened,
  false,
  "Menu completion rechecks resource permission"
);
delegatedEditCard.currentUser = resourceManager;
delegatedEditCard.args.resource.can_delete = false;
assert.equal(
  delegatedEditCard.canEdit,
  false,
  "Native resource visibility still applies"
);
editCard.currentUser = { admin: true };
const editMenuEvents = [];
let closeEditMenu;
editCard.args.onEdit = (resource) => editMenuEvents.push(resource);
const editMenu = {
  close: () => {
    editMenuEvents.push("closing");
    return new Promise((resolve) => {
      closeEditMenu = resolve;
    });
  },
};
const openingEdit = editCard.editFromMenu(editMenu);
await editCard.editFromMenu(editMenu);
await editCard.deleteFromMenu(editMenu);
assert.deepEqual(
  editMenuEvents,
  ["closing"],
  "Menu close locks repeated edit and delete actions"
);
closeEditMenu();
await openingEdit;
assert.equal(
  editMenuEvents[1],
  editCard.args.resource,
  "Edit opens only after native menu closes"
);
assert.equal(editCard.menuPending, false);
for (const abandon of [
  (candidate) => {
    candidate.currentUser = { moderator: true };
  },
  (candidate) => candidate.willDestroy(),
]) {
  const abandoned = makeEditCard();
  let opened = false;
  abandoned.args.onEdit = () => {
    opened = true;
  };
  await abandoned.editFromMenu({ close: async () => abandon(abandoned) });
  assert.equal(
    opened,
    false,
    "Menu close rechecks edit permission and lifecycle"
  );
}

const pointerCard = makeEditCard();
let shows = 0;
let finishShow;
const nativeMenu = {
  expanded: false,
  show: () => {
    shows++;
    nativeMenu.expanded = true;
    return new Promise((resolve) => {
      finishShow = resolve;
    });
  },
};
pointerCard.registerMenu(nativeMenu);
for (const pointerType of ["touch", "pen", undefined]) {
  await pointerCard.showForMouse({ pointerType });
  assert.equal(shows, 0, "Only a real mouse opens a menu on pointer entry");
}
const mouseOpening = pointerCard.showForMouse({ pointerType: "mouse" });
await pointerCard.showForMouse({ pointerType: "mouse" });
assert.equal(
  shows,
  1,
  "Repeated pointer entries cannot duplicate a pending show"
);
finishShow();
await mouseOpening;
let suppressed = 0;
const mouseClick = {
  detail: 1,
  stopImmediatePropagation: () => suppressed++,
  stopPropagation() {},
};
pointerCard.rememberPointer({ pointerType: "mouse" });
pointerCard.pinHoveredMenu(mouseClick);
assert.equal(suppressed, 1, "First mouse click pins a hover opened menu");
pointerCard.pinHoveredMenu(mouseClick);
assert.equal(
  suppressed,
  1,
  "Next mouse click passes through to the native close trigger"
);
nativeMenu.expanded = false;
const nextHover = pointerCard.showForMouse({ pointerType: "mouse" });
finishShow();
await nextHover;
pointerCard.rememberPointer({ pointerType: "touch" });
pointerCard.pinHoveredMenu(mouseClick);
assert.equal(suppressed, 1, "Touch always reaches the native toggle");
pointerCard.rememberPointer({ pointerType: "mouse" });
pointerCard.pinHoveredMenu({ ...mouseClick, detail: 0 });
assert.equal(suppressed, 1, "Keyboard click always reaches the native toggle");
nativeMenu.expanded = false;
pointerCard.currentUser = { moderator: true };
await pointerCard.showForMouse({ pointerType: "mouse" });
assert.equal(shows, 2, "Permission revocation prevents hover opening");
pointerCard.currentUser = { admin: true };
pointerCard.willDestroy();
await pointerCard.showForMouse({ pointerType: "mouse" });
assert.equal(shows, 2, "Destroyed cards cannot reopen a menu");
assert.notEqual(
  menuCard.menuIdentifier,
  new ResourceCard({ resource: { id: "another-resource" } }).menuIdentifier,
  "Each card must own a separate native menu"
);
const cardTemplate = read(
  "javascripts/discourse/components/isbf-learning-resource.gjs"
).split("  <template>")[1];
assert.ok(cardTemplate.includes("{{this.contributor}}"));
const fileTemplate = cardTemplate.match(
  /\{\{#each this.files as \|file\|\}\}([\s\S]*?)\{\{\/each\}\}/
)?.[1];
assert.ok(fileTemplate, "files keep their own attachment list");
assert.match(
  cardTemplate,
  /class="isbf-learning-resource__attachments"\s+\{\{contentImages\}\}/
);
assert.match(fileTemplate, /<a href=\{\{file.url\}\}>\{\{file.name\}\}<\/a>/);
assert.match(
  fileTemplate,
  /\{\{#if file.isImage\}\}\s*<a[\s\S]*?class="lightbox isbf-content-image-attachment"\s+href=\{\{file.url\}\}/
);
assert.match(
  fileTemplate,
  /aria-label=\{\{i18n \(themePrefix "isbf_v2.preview_image"\)\}\}/
);
assert.doesNotMatch(
  fileTemplate,
  /<img/,
  "attachment previews do not preload images"
);
let fileAnchorDepth = 0;
for (const tag of fileTemplate.matchAll(/<a\b|<\/a>/g)) {
  fileAnchorDepth += tag[0] === "</a>" ? -1 : 1;
  assert.ok(
    fileAnchorDepth >= 0 && fileAnchorDepth <= 1,
    "download and preview links stay independent"
  );
}
assert.equal(fileAnchorDepth, 0);

assert.ok(!/dAvatar|htmlSafe|\{\{\{/.test(cardTemplate));
assert.ok(cardTemplate.includes("{{#if this.canDelete}}"));
assert.ok(cardTemplate.includes("<DMenu"));
assert.ok(cardTemplate.includes('@icon="ellipsis"'));
assert.ok(cardTemplate.includes("@autofocus={{false}}"));
assert.ok(!cardTemplate.includes("@hoverGracePeriod"));
assert.ok(cardTemplate.includes("@triggers={{this.menuTriggers}}"));
assert.ok(cardTemplate.includes("@untriggers={{this.menuTriggers}}"));
assert.ok(cardTemplate.includes("@onRegisterApi={{this.registerMenu}}"));
assert.match(cardTemplate, /\{\{on "pointerenter" this.showForMouse\}\}/);
assert.match(cardTemplate, /\{\{on "pointerup" this.rememberPointer\}\}/);
assert.match(
  cardTemplate,
  /\{\{on "click" this.pinHoveredMenu capture=true\}\}/
);
assert.doesNotMatch(
  cardTemplate,
  /pointerleave|mouseleave|mouseenter|@triggers=.*hover/
);
assert.ok(cardTemplate.includes("{{#if this.canEdit}}"));
assert.ok(
  cardTemplate.indexOf("isbf-learning-resource__edit") <
    cardTemplate.indexOf("isbf-learning-resource__delete"),
  "Edit precedes delete"
);
assert.ok(
  cardTemplate.includes("@modalForMobile={{false}}"),
  "Tablet and mobile retain the same anchored native menu"
);
assert.ok(cardTemplate.indexOf("<h3>") < cardTemplate.indexOf("<time"));
assert.ok(
  cardTemplate.indexOf("@resource.description") <
    cardTemplate.indexOf("@searching"),
  "Descriptions must follow the title before search context"
);

const shareTemplate = read(
  "javascripts/discourse/components/isbf-learning-share-dialog.gjs"
).split("  <template>")[1];
assert.equal((shareTemplate.match(/<input\b/g) || []).length, 3);
assert.ok(shareTemplate.includes("<DModal"));
assert.ok(!/Composer|Upload|TagChooser/.test(shareTemplate));
assert.ok(shareTemplate.includes("{{#if this.descriptionEnabled}}"));
assert.ok(shareTemplate.includes("{{#if this.contributorEnabled}}"));
assert.ok(
  !shareTemplate.includes('maxlength="15"'),
  "Contributor limit uses Unicode code points"
);
assert.ok(
  shareTemplate.indexOf("this.descriptionEnabled") <
    shareTemplate.indexOf("this.changeLink")
);
assert.ok(
  shareTemplate.indexOf("this.changeLink") <
    shareTemplate.indexOf("this.contributorEnabled")
);
assert.equal((shareTemplate.match(/<textarea\b/g) || []).length, 1);
assert.ok(
  !shareTemplate.includes('maxlength="300"'),
  "UTF-16 maxlength would reject valid emoji"
);
const oldBackend = makeDialog();
oldBackend.site.isbf_learning.resource_description = false;
saving = oldBackend.save(submitEvent);
assert.ok(!("description" in submissions.at(-1).data));
assert.ok(!("contributor" in submissions.at(-1).data));
completeSubmission({ success: true, pending: true });
await saving;

const courseSubmissions = [];
const courseResults = [];
let finishCourse;
let failCourse;
const CourseDialog = componentClass("isbf-learning-course-dialog", {
  ajax: (url, options) => {
    courseSubmissions.push({ url, ...options });
    return new Promise((resolve, reject) => {
      finishCourse = resolve;
      failCourse = reject;
    });
  },
});
const makeCourseDialog = (request = true) => {
  const dialog = new CourseDialog({
    grade: 1,
    request,
    onClose() {},
    onSubmitted: (response, grade) => courseResults.push({ response, grade }),
  });
  dialog.name = " Economics ";
  return dialog;
};
const requestForm = makeCourseDialog();
assert.equal(requestForm.title, "isbf_v2.learning_request_course");
assert.equal(requestForm.submitLabel, "isbf_v2.learning_submit_request");
const staffForm = makeCourseDialog(false);
assert.equal(staffForm.title, "isbf_v2.learning_add_course");
assert.equal(staffForm.submitLabel, "isbf_v2.learning_save");
saving = requestForm.save(submitEvent);
await requestForm.save(submitEvent);
requestForm.formChanged("grade", 2);
assert.equal(requestForm.grade, 1, "Saving must retain submitted grade");
assert.equal(
  courseSubmissions.length,
  1,
  "Duplicate course submits send one POST"
);
assert.deepEqual(plain(courseSubmissions[0]), {
  url: "/isbf/learning/courses",
  type: "POST",
  data: { name: "Economics", grade: 1 },
});
failCourse({ jqXHR: { responseJSON: { errors: ["Duplicate course"] } } });
await saving;
assert.equal(requestForm.error, "Duplicate course");
assert.equal(requestForm.name, " Economics ");
assert.equal(requestForm.grade, 1);
assert.equal(requestForm.saving, false);
saving = requestForm.save(submitEvent);
finishCourse({ success: true, pending: true });
await saving;
assert.equal(courseResults.length, 0, "Malformed course response allows retry");
saving = requestForm.save(submitEvent);
finishCourse({ success: true, pending: true, reviewable_id: 7 });
await saving;
assert.deepEqual(plain(courseResults[0]), {
  response: { success: true, pending: true, reviewable_id: 7 },
  grade: 1,
});
saving = staffForm.save(submitEvent);
finishCourse({ success: true, pending: false, course: { id: courseId } });
await saving;
assert.equal(courseResults.length, 2);
const abandonedCourse = makeCourseDialog();
saving = abandonedCourse.save(submitEvent);
abandonedCourse.willDestroy();
finishCourse({ success: true, pending: true, reviewable_id: 8 });
await saving;
assert.equal(
  courseResults.length,
  2,
  "Destroyed dialog ignores late course success"
);
const failedDestroyedCourse = makeCourseDialog();
saving = failedDestroyedCourse.save(submitEvent);
failedDestroyedCourse.willDestroy();
failCourse(new Error("Late failure"));
await saving;
assert.equal(failedDestroyedCourse.error, null);
const closedCourse = makeCourseDialog();
closedCourse.close();
await closedCourse.save(submitEvent);
assert.equal(courseSubmissions.length, 6, "Closed dialog ignores later submit");
const legacyStaffForm = makeCourseDialog(false);
saving = legacyStaffForm.save(submitEvent);
finishCourse({ course: { id: courseId } });
await saving;
assert.deepEqual(
  plain(courseResults.at(-1).response),
  {
    course: { id: courseId },
    success: true,
    pending: false,
  },
  "Staff may create courses against the previous backend"
);
const strictRequestForm = makeCourseDialog();
const resultsBeforeInvalidRequest = courseResults.length;
saving = strictRequestForm.save(submitEvent);
finishCourse({ course: { id: courseId } });
await saving;
assert.equal(
  courseResults.length,
  resultsBeforeInvalidRequest,
  "Ordinary course requests must require the review response contract"
);
assert.equal(strictRequestForm.saving, false);
assert.equal(strictRequestForm.name, " Economics ");
const learningPage = read("javascripts/discourse/components/isbf-learning.gjs");
assert.ok(
  !learningPage.includes("Composer") && !learningPage.includes("this.composer")
);

const listRequests = [];
const LearningPage = componentClass("isbf-learning", {
  ...resources.namespace,
  learningConfig,
  learningResourceQuery,
  clearTimeout,
  setTimeout,
  document: { activeElement: { focus() {} } },
  ajax: (url, options) => {
    listRequests.push({ url, options });
    return Promise.resolve({ resources: [] });
  },
});
const page = new LearningPage();
assert.equal(page.canSubmitCourses, false, "Guests cannot request courses");
page.site = { isbf_learning: { ...config, link_sharing: true } };
page.currentUser = {};
assert.equal(
  page.canSubmitCourses,
  false,
  "Old backends retain staff course creation"
);
page.site.isbf_learning.course_requests = true;
assert.equal(page.canSubmitCourses, true);
page.grade = null;
assert.equal(
  page.canSubmitCourses,
  false,
  "Deleting the last parent leaves no course destination"
);
page.grade = 1;
assert.equal(page.courseActionLabel, "isbf_v2.learning_request_course");
page.courses = [{ id: courseId, grade: 1, name: "Economics" }];
page.openCourseDialog();
assert.equal(
  page.showCourseDialog,
  false,
  "Only administrators can open the add form"
);
page.courseSubmitted({ success: true, pending: true }, 2);
assert.equal(page.coursePending, false);
assert.equal(page.grade, 1);
assert.equal(
  page.courses.length,
  1,
  "Pending requests create no phantom courses"
);
assert.equal(
  listRequests.length,
  0,
  "Pending requests do not reload the directory"
);
page.currentUser = {
  academy_moderator_permissions: { manage_resources: true },
};
page.site.isbf_learning.course_requests = false;
assert.equal(page.canSubmitCourses, true);
assert.equal(page.courseActionLabel, "isbf_v2.learning_add_course");
assert.equal(
  page.canAddDirectories,
  false,
  "Delegated managers do not see the administrator add entry"
);
page.currentUser = { admin: true };
page.openAddDialog();
assert.equal(page.showAddDialog, true);
page.openCourseDialog();
assert.equal(
  page.showAddDialog,
  false,
  "Choosing a form replaces the first dialog"
);
page.courseSubmitted({ success: true, pending: false }, 1);
assert.equal(page.coursePending, false);
assert.equal(listRequests[0].url, "/isbf/learning/courses");
await new Promise(setImmediate);
listRequests.length = 0;
page.courses = [{ id: courseId, grade: 1, name: "Economics" }];
page.selectedCourseId = courseId;
page.share();
page.resourceSubmitted({ success: true, pending: true });
assert.equal(page.sharePending, true);
assert.equal(
  listRequests.length,
  0,
  "Pending resources must not refresh the list"
);
page.share();
page.query = "changed search";
page.resourceSubmitted({ success: true, pending: false });
assert.equal(listRequests.length, 0, "Changed search must not be overwritten");
page.share();
page.selectedCourseId = "other-course";
page.resourceSubmitted({ success: true, pending: false });
assert.equal(listRequests.length, 0, "Changed course must not be overwritten");
page.selectedCourseId = courseId;
page.query = "";
page.share();
page.resourceSubmitted({ success: true, pending: false });
assert.equal(
  listRequests.length,
  1,
  "Published resources should refresh the matching list"
);
await Promise.resolve();
page.share();
const contextBeforeDestroyedResponse = page.shareContext;
page.isDestroyed = true;
page.resourceSubmitted({ success: true, pending: false });
assert.equal(page.shareContext, contextBeforeDestroyedResponse);
assert.equal(
  listRequests.length,
  1,
  "Destroyed page must ignore late resource responses"
);
page.isDestroyed = false;
page.closeShareDialog();
page.site.isbf_learning.link_sharing = false;
page.share();
assert.equal(
  page.shareContext,
  null,
  "Old backend must not open unsupported sharing"
);
page.site.isbf_learning.link_sharing = true;
page.site.isbf_learning.resource_admin_management = true;
page.currentUser = { moderator: true };
assert.equal(page.shareLabel, "isbf_v2.learning_apply_share");
page.currentUser = { admin: true };
assert.equal(page.shareLabel, "isbf_v2.learning_share");
page.site.isbf_learning.resource_admin_management = false;
page.currentUser = {};
assert.equal(
  page.shareLabel,
  "isbf_v2.learning_share",
  "Old backend retains its existing label"
);
page.query = "search at deletion completion";
page.loadMore();
await Promise.resolve();
assert.equal(listRequests.at(-1).options.data.page, 1);
page.resourceDeleted();
assert.equal(
  listRequests.at(-1).options.data.page,
  0,
  "Deletion resets pagination"
);
assert.equal(
  listRequests.at(-1).options.data.q,
  page.query,
  "Deletion reloads current search"
);
await Promise.resolve();
page.query = "";
page.resourceDeleted();
assert.equal(
  listRequests.at(-1).options.data.course_id,
  courseId,
  "Deletion reloads current course"
);
const requestsBeforeDestroy = listRequests.length;
page.site.isbf_learning.resource_admin_management = true;
page.currentUser = { admin: true };
page.query = "cross course search";
const searchResource = {
  ...editableResource,
  can_delete: true,
  course: { id: "other-course", name: "Other course" },
};
page.editResource(searchResource);
assert.equal(
  page.shareContext.course,
  searchResource.course,
  "Search edits use the resource's real course"
);
assert.equal(page.shareContext.resource, searchResource);
assert.equal(
  page.selectedCourseId,
  courseId,
  "Editing does not change the current directory filter"
);
page.resourceSubmitted({ success: true, pending: false, edited: true });
assert.equal(
  listRequests.at(-1).options.data.q,
  "cross course search",
  "Edit refreshes the current search across courses"
);
assert.equal(listRequests.at(-1).options.data.page, 0);
await Promise.resolve();
page.query = "";
page.editResource(searchResource);
page.resourceSubmitted({ success: true, pending: false, edited: true });
assert.equal(
  listRequests.at(-1).options.data.course_id,
  courseId,
  "Edit refreshes the current course filter"
);
await Promise.resolve();
page.editResource(searchResource);
page.query = "changed while editing";
const beforeChangedEdit = listRequests.length;
page.resourceSubmitted({ success: true, pending: false, edited: true });
assert.equal(
  listRequests.length,
  beforeChangedEdit,
  "Late edit cannot overwrite a changed search"
);
page.editResource(searchResource);
page.closeShareDialog();
page.resourceSubmitted({ success: true, pending: false, edited: true });
assert.equal(
  listRequests.length,
  beforeChangedEdit,
  "Cancelled edit ignores a late parent callback"
);
page.currentUser = { moderator: true };
page.editResource(searchResource);
assert.equal(page.shareContext, null);
page.currentUser = resourceManager;
page.editResource(searchResource);
assert.equal(page.shareContext.resource, searchResource);
page.closeShareDialog();
for (const user of usersWithoutResourceManagement) {
  page.currentUser = user;
  page.editResource(searchResource);
  assert.equal(page.shareContext, null);
}
assert.ok(learningPage.includes("@resource={{this.shareContext.resource}}"));
assert.ok(
  read("javascripts/discourse/components/isbf-resource-list.gjs").includes(
    "@onEdit={{@page.editResource}}"
  )
);
const requestsBeforeEditDestroy = listRequests.length;
page.isDestroying = true;
page.resourceDeleted();
assert.equal(listRequests.length, requestsBeforeEditDestroy);
assert.ok(requestsBeforeEditDestroy > requestsBeforeDestroy);
const gradePicker = read(
  "javascripts/discourse/components/isbf-learning-grade-picker.gjs"
);
assert.ok(gradePicker.includes('@placement="bottom-start"'));
assert.ok(gradePicker.includes('@visibilityOptimizer="none"'));
assert.ok(gradePicker.includes('@strategy="fixed"'));
assert.ok(gradePicker.includes("@constrainHeightToViewport={{true}}"));
assert.ok(gradePicker.includes("@crossAxisShift={{false}}"));
assert.doesNotMatch(gradePicker, /menu\.options\s*=/);
const learningStyles = read("stylesheets/learning-resources.scss");
// Inspect active source rules at the supported widths; this is not browser QA.
function widthStyles(source, width) {
  const media = /@media\s*\(width\s*(<=|>=|<|>)\s*(\d+)px\)\s*\{/g;
  let result = "";
  let position = 0;
  for (const match of source.matchAll(media)) {
    const [header, operator, boundary] = match;
    const offset = match.index;
    result += source.slice(position, offset);
    let depth = 1;
    let end = offset + header.length;
    for (; end < source.length && depth; end++) {
      if (source[end] === "{") {
        depth++;
      }
      if (source[end] === "}") {
        depth--;
      }
    }
    const limit = Number(boundary);
    const active =
      operator === "<="
        ? width <= limit
        : operator === ">="
          ? width >= limit
          : operator === "<"
            ? width < limit
            : width > limit;
    if (active) {
      result += source.slice(offset + header.length, end - 1);
    }
    position = end;
  }
  return result + source.slice(position);
}
for (const width of [390, 430, 1024, 1440]) {
  const styles = widthStyles(read("common/common.scss"), width);
  const grids = [
    ...styles.matchAll(
      /\.isbf-v2-workbench__grid\s*\{[^}]*grid-template-columns: repeat\((\d+), minmax\(0, 1fr\)\);/g
    ),
  ];
  assert.equal(
    Number(grids.at(-1)[1]),
    width === 1024 ? 3 : 4,
    `${width}px preserves the existing shared workbench grid`
  );
  assert.doesNotMatch(
    styles,
    /\.isbf-v2-workbench__card[^}]*\border\s*:/,
    `${width}px visual order follows the shared card order`
  );
}
for (const width of [390, 430, 768, 820, 1024, 1440]) {
  const styles = widthStyles(learningStyles, width);
  assert.match(
    styles,
    /\.isbf-learning-resource__header\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/,
    `${width}px title column can shrink`
  );
  assert.match(
    styles,
    /\.isbf-learning-resource__more\.btn\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px;/,
    `${width}px native trigger remains a touch target`
  );
  assert.match(
    styles,
    /\.isbf-learning-resource__edit\.btn,\s*\.isbf-learning-resource__delete\.btn\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px;/,
    `${width}px menu actions remain touch targets`
  );
  assert.match(
    styles,
    /\.isbf-learning-resource-menu \.btn:focus-visible\s*\{[^}]*outline:/,
    `${width}px menu has keyboard focus`
  );
}
assert.match(
  learningStyles,
  /\.isbf-learning__grade\s*\{[\s\S]*?justify-content: flex-start;[\s\S]*?order: -1;/
);
assert.match(
  learningStyles,
  /\.isbf-learning-resource__description\s*\{[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: pre-wrap;/
);
assert.match(
  learningStyles,
  /\.isbf-learning-resource__header\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;[^}]*align-items: baseline;/
);
assert.match(
  learningStyles,
  /\.isbf-learning-resource__more\.btn\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px;/
);
assert.match(
  learningStyles,
  /\.isbf-learning-resource__metadata\s*\{[^}]*margin-top: var\(--isbf-v2-space-2\);/
);
const reviewSource = read(
  "javascripts/discourse/components/reviewable-isbf-learning-course.gjs"
);
assert.ok(reviewSource.includes("{{@reviewable.payload.course_name}}"));
assert.ok(!reviewSource.includes("htmlSafe") && !reviewSource.includes("{{{"));
assert.ok(initializer.includes('"ReviewableIsbfLearningCourse"'));
assert.ok(
  initializer.includes(
    'import("../components/reviewable-isbf-learning-course")'
  )
);
const ReviewDetail = componentClass("reviewable-isbf-learning-course");
for (const grade of [1, 2, 3, 4]) {
  assert.equal(
    new ReviewDetail({ reviewable: { payload: { grade } } }).gradeLabel,
    `isbf_v2.learning_grade_${grade}`
  );
}
assert.equal(
  new ReviewDetail({ reviewable: { payload: { grade: 9 } } }).gradeLabel,
  ""
);
process.stdout.write(
  "Learning sharing/editing, admin lifecycle, native pointer menus, responsive source constraints, course reviews, Unicode limits and safe links OK\n"
);
