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
function componentClass(path, globals = {}) {
  const source = read(`javascripts/discourse/components/${path}.gjs`);
  const className = source.match(/export default class (\w+)/)[1];
  const body = source
    .slice(
      source.indexOf("export default class"),
      source.indexOf("  <template>"),
    )
    .replace("export default class", "class")
    .replace(/@service (\w+);/g, "$1;")
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
    themePrefix: (key) => key,
    i18n: (key) => key,
    ...globals,
  });
}

let completeSubmission;
let rejectSubmission;
let submissions = [];
const ShareDialog = componentClass("isbf-learning-share-dialog", {
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
  "301 Unicode code points exceed the limit",
);
form.site.isbf_learning.resource_description = false;
assert.equal(
  form.saveDisabled,
  false,
  "Old backend does not validate hidden fields",
);
form.site.isbf_learning.resource_description = true;
form.description = "Useful notes\nSecond line";
const submitEvent = { preventDefault() {} };
let saving = form.save(submitEvent);
await form.save(submitEvent);
assert.equal(
  submissions.length,
  1,
  "Repeated submit must not send a second POST",
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
  "Default display names are not constrained",
);
assert.equal(contributorForm.shareLabel, "isbf_v2.learning_apply_share");
assert.equal(contributorForm.submitLabel, "isbf_v2.learning_submit_request");
contributorForm.currentUser.moderator = true;
assert.equal(
  contributorForm.shareLabel,
  "isbf_v2.learning_apply_share",
  "Moderators also apply",
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
  "Unsupported fields cannot block submit",
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
  "Blank uses backend display name fallback",
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
  "Unedited defaults are resolved by backend",
);
completeSubmission({ success: true, pending: false });
await saving;

const deletions = [];
let completeDeletion;
let rejectDeletion;
const ResourceCard = componentClass("isbf-learning-resource", {
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
  "New cards must not repeat their title link",
);
assert.equal(card.files.length, 1, "Legacy attachments must remain accessible");
card.args.resource.links = [];
assert.equal(
  card.titleUrl,
  undefined,
  "File-only cards must not navigate to a topic",
);
assert.equal(card.contributor, "isbf_v2.learning_unknown_contributor");
card.args.resource.author = { username: "legacy", name: "Legacy Author" };
assert.equal(card.contributor, "Legacy Author");
card.args.resource.author.name = "";
assert.equal(card.contributor, "legacy");
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
  "Failures retain card for retry",
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
  "Permissions are rechecked after confirmation",
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
  "Navigation during confirmation cancels the request",
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
  "Menu cancellation makes no request",
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
  "Menu close rechecks current permissions",
);
await menuRevoked.deleteFromMenu({
  close: async () => {
    throw new Error("Unauthorized users cannot operate the menu");
  },
});
assert.deepEqual(plain(menuCard.menuTriggers), {
  desktop: ["hover", "click"],
  mobile: ["click"],
});
assert.notEqual(
  menuCard.menuIdentifier,
  new ResourceCard({ resource: { id: "another-resource" } }).menuIdentifier,
  "Each card must own a separate native menu",
);
const cardTemplate = read(
  "javascripts/discourse/components/isbf-learning-resource.gjs",
).split("  <template>")[1];
assert.ok(cardTemplate.includes("{{this.contributor}}"));
assert.ok(!/dAvatar|htmlSafe|\{\{\{/.test(cardTemplate));
assert.ok(cardTemplate.includes("{{#if this.canDelete}}"));
assert.ok(cardTemplate.includes("<DMenu"));
assert.ok(cardTemplate.includes('@icon="ellipsis"'));
assert.ok(cardTemplate.includes("@autofocus={{false}}"));
assert.ok(cardTemplate.includes("@hoverGracePeriod={{300}}"));
assert.ok(cardTemplate.includes("@triggers={{this.menuTriggers}}"));
assert.ok(cardTemplate.includes("@untriggers={{this.menuTriggers}}"));
assert.ok(cardTemplate.indexOf("<h3>") < cardTemplate.indexOf("<time"));
assert.ok(
  cardTemplate.indexOf("@resource.description") <
    cardTemplate.indexOf("@searching"),
  "Descriptions must follow the title before search context",
);

const shareTemplate = read(
  "javascripts/discourse/components/isbf-learning-share-dialog.gjs",
).split("  <template>")[1];
assert.equal((shareTemplate.match(/<input\b/g) || []).length, 3);
assert.ok(shareTemplate.includes("<DModal"));
assert.ok(!/Composer|Upload|TagChooser/.test(shareTemplate));
assert.ok(shareTemplate.includes("{{#if this.descriptionEnabled}}"));
assert.ok(shareTemplate.includes("{{#if this.contributorEnabled}}"));
assert.ok(
  !shareTemplate.includes('maxlength="15"'),
  "Contributor limit uses Unicode code points",
);
assert.ok(
  shareTemplate.indexOf("this.descriptionEnabled") <
    shareTemplate.indexOf("this.changeLink"),
);
assert.ok(
  shareTemplate.indexOf("this.changeLink") <
    shareTemplate.indexOf("this.contributorEnabled"),
);
assert.equal((shareTemplate.match(/<textarea\b/g) || []).length, 1);
assert.ok(
  !shareTemplate.includes('maxlength="300"'),
  "UTF-16 maxlength would reject valid emoji",
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
requestForm.changeGrade(2);
assert.equal(requestForm.grade, 1, "Saving must retain submitted grade");
assert.equal(
  courseSubmissions.length,
  1,
  "Duplicate course submits send one POST",
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
  "Destroyed dialog ignores late course success",
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
  "Staff may create courses against the previous backend",
);
const strictRequestForm = makeCourseDialog();
const resultsBeforeInvalidRequest = courseResults.length;
saving = strictRequestForm.save(submitEvent);
finishCourse({ course: { id: courseId } });
await saving;
assert.equal(
  courseResults.length,
  resultsBeforeInvalidRequest,
  "Ordinary course requests must require the review response contract",
);
assert.equal(strictRequestForm.saving, false);
assert.equal(strictRequestForm.name, " Economics ");
const learningPage = read("javascripts/discourse/components/isbf-learning.gjs");
assert.ok(
  !learningPage.includes("Composer") && !learningPage.includes("this.composer"),
);

const listRequests = [];
const LearningPage = componentClass("isbf-learning", {
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
  "Old backends retain staff course creation",
);
page.site.isbf_learning.course_requests = true;
assert.equal(page.canSubmitCourses, true);
assert.equal(page.courseActionLabel, "isbf_v2.learning_request_course");
page.courses = [{ id: courseId, grade: 1, name: "Economics" }];
page.openCourseDialog();
page.courseSubmitted({ success: true, pending: true }, 2);
assert.equal(page.coursePending, true);
assert.equal(page.grade, 1);
assert.equal(
  page.courses.length,
  1,
  "Pending requests create no phantom courses",
);
assert.equal(
  listRequests.length,
  0,
  "Pending requests do not reload the directory",
);
page.currentUser = { moderator: true };
page.site.isbf_learning.course_requests = false;
assert.equal(page.canSubmitCourses, true);
assert.equal(page.courseActionLabel, "isbf_v2.learning_add_course");
page.openCourseDialog();
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
  "Pending resources must not refresh the list",
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
  "Published resources should refresh the matching list",
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
  "Destroyed page must ignore late resource responses",
);
page.isDestroyed = false;
page.closeShareDialog();
page.site.isbf_learning.link_sharing = false;
page.share();
assert.equal(
  page.shareContext,
  null,
  "Old backend must not open unsupported sharing",
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
  "Old backend retains its existing label",
);
page.query = "search at deletion completion";
page.loadMore();
await Promise.resolve();
assert.equal(listRequests.at(-1).options.data.page, 1);
page.resourceDeleted();
assert.equal(
  listRequests.at(-1).options.data.page,
  0,
  "Deletion resets pagination",
);
assert.equal(
  listRequests.at(-1).options.data.q,
  page.query,
  "Deletion reloads current search",
);
await Promise.resolve();
page.query = "";
page.resourceDeleted();
assert.equal(
  listRequests.at(-1).options.data.course_id,
  courseId,
  "Deletion reloads current course",
);
const requestsBeforeDestroy = listRequests.length;
page.isDestroying = true;
page.resourceDeleted();
assert.equal(listRequests.length, requestsBeforeDestroy);
const gradePicker = read(
  "javascripts/discourse/components/isbf-learning-grade-picker.gjs",
);
assert.ok(gradePicker.includes('@placement="bottom-start"'));
assert.ok(gradePicker.includes('@visibilityOptimizer="none"'));
assert.ok(gradePicker.includes('strategy: "fixed"'));
const learningStyles = read("stylesheets/learning-resources.scss");
assert.match(
  learningStyles,
  /\.isbf-learning__grade\s*\{[\s\S]*?justify-content: flex-start;[\s\S]*?order: -1;/,
);
assert.match(
  learningStyles,
  /\.isbf-learning-resource__description\s*\{[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: pre-wrap;/,
);
assert.match(
  learningStyles,
  /\.isbf-learning-resource__header\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;[^}]*align-items: baseline;/,
);
assert.match(
  learningStyles,
  /\.isbf-learning-resource__more\.btn\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px;/,
);
assert.match(
  learningStyles,
  /\.isbf-learning-resource p\.isbf-learning-resource__credit\s*\{[^}]*margin-top: var\(--isbf-v2-space-2\);/,
);
const reviewSource = read(
  "javascripts/discourse/components/reviewable-isbf-learning-course.gjs",
);
assert.ok(reviewSource.includes("{{@reviewable.payload.course_name}}"));
assert.ok(!reviewSource.includes("htmlSafe") && !reviewSource.includes("{{{"));
assert.ok(initializer.includes('"ReviewableIsbfLearningCourse"'));
assert.ok(
  initializer.includes(
    'import("../components/reviewable-isbf-learning-course")',
  ),
);
const ReviewDetail = componentClass("reviewable-isbf-learning-course");
for (const grade of [1, 2, 3, 4]) {
  assert.equal(
    new ReviewDetail({ reviewable: { payload: { grade } } }).gradeLabel,
    `isbf_v2.learning_grade_${grade}`,
  );
}
assert.equal(
  new ReviewDetail({ reviewable: { payload: { grade: 9 } } }).gradeLabel,
  "",
);
console.log(
  "Course requests, contributor limits, admin deletion lifecycle, review details, Unicode descriptions, safe links and learning helpers OK",
);
