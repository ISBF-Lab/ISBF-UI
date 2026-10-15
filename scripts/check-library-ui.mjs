import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const resources = new vm.SourceTextModule(
  read("javascripts/discourse/lib/learning-resources.js")
);
await resources.link(() => {});
await resources.evaluate();
const { libraryConfig, learningEditDetails } = resources.namespace;
const config = {
  category_id: 20,
  link_sharing: true,
  catalog_requests: true,
  resource_description: true,
  resource_contributor: true,
  resource_admin_management: true,
};
assert.equal(libraryConfig({ isbf_library: config }), config);
assert.equal(
  libraryConfig({ isbf_library: config, isbf_learning: { category_id: 20 } }),
  null
);
assert.equal(
  libraryConfig({ isbf_library: { ...config, category_id: "20" } }),
  null
);
assert.equal(libraryConfig({}), null);
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
    services: {},
    themePrefix: (key) => key,
    i18n: (key) => key,
    ...globals,
  });
}

const requests = [];
const Page = componentClass("isbf-resource-page", {
  ...resources.namespace,
  clearTimeout,
  setTimeout,
  document: { activeElement: { focus() {} } },
  ajax: (url, options) =>
    new Promise((resolve, reject) =>
      requests.push({ url, options, resolve, reject })
    ),
});
const page = new Page({ library: true });
page.site = { isbf_library: config };
page.currentUser = {};
const loading = page.loadCourses();
assert.equal(requests.at(-1).url, "/isbf/library/categories");
requests.at(-1).resolve({ categories: [] });
await new Promise(setImmediate);
assert.equal(requests.at(-1).url, "/isbf/library/groups");
requests.at(-1).resolve({ groups: [] });
await loading;
assert.equal(page.grade, null);
assert.equal(page.selectedCourseId, null);
assert.equal(page.shareDisabled, true);
page.openCourseDialog();
assert.equal(page.showCourseDialog, false);
page.openCourseDialog("category");
assert.equal(page.showCourseDialog, true);
page.courseSubmitted({ success: true, pending: true }, null);
assert.equal(page.categories.length, 0);
assert.equal(page.coursePending, true);
assert.equal(page.categoryActionLabel, "isbf_v2.library_request_category");
page.categories = [{ id: "parent", name: "分类" }];
page.courses = [{ id: "group", name: "分组", category_id: "parent" }];
page.changeGrade("parent");
assert.deepEqual(plain(requests.at(-1).options.data), {
  group_id: "group",
  page: 0,
});
const stale = requests.at(-1);
page.query = "global";
page.resourceDeleted();
assert.deepEqual(plain(requests.at(-1).options.data), { q: "global", page: 0 });
stale.resolve({ resources: [{ id: 88 }], has_more: true });
await new Promise(setImmediate);
assert.equal(page.resources.length, 0);
requests.at(-1).resolve({ resources: [{ id: 90 }], has_more: false });
await new Promise(setImmediate);
assert.equal(page.resources[0].id, 90);
page.resourceDeleted();
const abandoned = requests.at(-1);
page.willDestroy();
abandoned.resolve({ resources: [{ id: 99 }] });
await new Promise(setImmediate);
assert.equal(page.resources.length, 0);
const other = new Page({ library: true });
assert.equal(other.query, "");
assert.equal(other.selectedCourseId, null);

const post = {
  id: 2,
  topic_id: 1,
  post_number: 1,
  can_edit: true,
  raw: "original",
  isbf_library_group_id: "group",
  isbf_library_files: [],
  isbf_library_link: "https://example.org",
  isbf_library_description: "intro",
  isbf_library_contributor: "author",
};
const topic = {
  id: 1,
  title: "Original title",
  post_stream: { posts: [{ id: 2, post_number: 1 }] },
};
assert.equal(learningEditDetails(topic, post, "group"), null);
assert.equal(learningEditDetails(topic, post, "wrong", "isbf_library"), null);
assert.equal(
  learningEditDetails(topic, post, "group", "isbf_library").description,
  "intro"
);
const submissions = [];
const results = [];
const Dialog = componentClass("isbf-resource-share-dialog", {
  ...resources.namespace,
  ajax: async (url, options) => {
    submissions.push({ url, ...options });
    if (url === "/t/1.json") {
      return topic;
    }
    if (url === "/posts/2.json" && !options) {
      return post;
    }
    if (options?.type === "PUT") {
      return { post: { id: 2, topic_id: 1 } };
    }
    return { success: true, pending: true };
  },
});
const dialog = new Dialog({
  library: true,
  course: { id: "group", name: "分组" },
  onSubmitted: (result) => results.push(result),
  onClose() {},
});
dialog.site = { isbf_library: config };
dialog.siteSettings = {
  min_topic_title_length: 3,
  max_topic_title_length: 255,
};
dialog.currentUser = { username: "test" };
dialog.title = "Resource title";
dialog.link = "https://example.org";
dialog.description = "description";
dialog.contributor = "author";
await dialog.save({ preventDefault() {} });
assert.equal(submissions[0].url, "/isbf/library/resources");
assert.equal(submissions[0].data.group_id, "group");
assert.ok(!("course_id" in submissions[0].data));
assert.equal(results[0].pending, true);
const edit = new Dialog({
  library: true,
  course: { id: "group" },
  onSubmitted: (result) => results.push(result),
  onClose() {},
});
edit.site = { isbf_library: config };
edit.siteSettings = dialog.siteSettings;
edit.currentUser = { admin: true };
edit.args.resource = { id: 1, link_only: true, files: [] };
await edit.retryLoad();
assert.equal(edit.editReady, true);
edit.title = "Changed title";
await edit.save({ preventDefault() {} });
const update = submissions.at(-1);
assert.equal(update.type, "PUT");
assert.equal(update.data.title, "Changed title");
assert.equal(update.data.post.isbf_library_link, "https://example.org");
assert.equal(update.data.post.isbf_library_description, "intro");
assert.ok(!("isbf_learning_link" in update.data.post));
assert.ok(
  read("javascripts/discourse/components/isbf-library.gjs").includes(
    "<ISBFResourcePage"
  )
);
for (const [old, shared] of [
  ["isbf-learning", "isbf-resource-page"],
  ["isbf-learning-resource", "isbf-resource-item"],
  ["isbf-learning-share-dialog", "isbf-resource-share-dialog"],
  ["isbf-learning-course-dialog", "isbf-resource-directory-dialog"],
  ["isbf-learning-grade-picker", "isbf-resource-parent-picker"],
]) {
  assert.ok(
    read(`javascripts/discourse/components/${old}.gjs`).includes(
      `export { default } from "./${shared}"`
    )
  );
}
assert.ok(
  read("javascripts/discourse/api-initializers/isbf-library.js").includes(
    '"ReviewableIsbfLibraryDirectory"'
  )
);
assert.ok(
  read(
    "javascripts/discourse/components/reviewable-isbf-library-directory.gjs"
  ).includes("{{@reviewable.payload.name}}")
);

const Directory = componentClass("isbf-resource-directory-dialog", {
  ajax: async (url, options) => {
    submissions.push({ url, ...options });
    return {
      success: true,
      pending: false,
      category: { id: "new-category" },
      group: { id: "new-group" },
    };
  },
});
for (const kind of ["category", "group"]) {
  const directory = new Directory({
    library: true,
    kind,
    grade: "parent",
    onSubmitted() {},
    onClose() {},
  });
  directory.name = "New name";
  await directory.save({ preventDefault() {} });
  const submission = submissions.at(-1);
  assert.equal(
    submission.url,
    `/isbf/library/${kind === "category" ? "categories" : "groups"}`
  );
  assert.deepEqual(
    plain(submission.data),
    kind === "category"
      ? { name: "New name" }
      : { name: "New name", category_id: "parent" }
  );
}
const workbenchSource = read(
  "javascripts/discourse/components/isbf-v2-workbench.gjs"
);
const Workbench = componentClass("isbf-v2-workbench", {
  ...resources.namespace,
  CARDS: vm.runInNewContext(
    workbenchSource.match(/const CARDS = (\[[\s\S]*?\n\]);/)[1]
  ),
  alumniConfig: () => false,
  marketplaceConfig: () => false,
  careersConfig: () => false,
  teamupConfig: () => false,
});
const workbench = new Workbench();
workbench.site = { isbf_library: config };
assert.equal(workbench.cards[1].href, "/isbf/library");
workbench.site = {};
assert.equal(workbench.cards[1].href, null);

const Item = componentClass("isbf-resource-item", {
  ...resources.namespace,
  ajax: async (url, options) => {
    submissions.push({ url, ...options });
    return { success: true };
  },
});
let deleted = false;
const item = new Item({
  library: true,
  resource: { id: 101, can_delete: true, link_only: true, files: [] },
  onDeleted() {
    deleted = true;
  },
});
item.site = { isbf_library: config };
item.currentUser = { moderator: true };
assert.equal(item.canDelete, false);
item.currentUser = { admin: true };
item.dialog = { confirm: async () => true };
await item.deleteResource();
assert.equal(submissions.at(-1).url, "/isbf/library/resources/101");
assert.equal(submissions.at(-1).type, "DELETE");
assert.equal(deleted, true);
const catalogPage = new Page({ library: true });
catalogPage.site = { isbf_library: config };
catalogPage.currentUser = { admin: true };
const catalogLoading = catalogPage.loadCourses();
const lateCatalog = requests.at(-1);
catalogPage.willDestroy();
lateCatalog.resolve({ categories: [{ id: "late", name: "Late" }] });
await catalogLoading;
assert.equal(catalogPage.categories.length, 0);

const learningConfig = {
  ...config,
  category_id: 10,
  course_requests: true,
  grades: [1, 2, 3, 4].map((id) => ({ id, label: `Year ${id}` })),
};
const academyUser = {
  academy_moderator_role: true,
  academy_moderator_permissions: { manage_resources: true },
};
for (const library of [false, true]) {
  const permissionPage = new Page({ library });
  permissionPage.site = {
    isbf_learning: learningConfig,
    isbf_library: config,
    categories: [{ id: 10, canCreateTopic: false }],
  };
  permissionPage.currentUser = academyUser;
  permissionPage.courses = [{ id: "group", grade: 1, category_id: "parent" }];
  permissionPage.selectedCourseId = "group";
  assert.equal(permissionPage.canManageCourses, !library);
  assert.equal(permissionPage.canSubmitResources, library);
  assert.equal(permissionPage.canSubmitCourses, library);
  assert.equal(permissionPage.shareDisabled, !library);
  assert.equal(
    permissionPage.shareLabel,
    library ? "isbf_v2.learning_apply_share" : "isbf_v2.learning_share"
  );
  permissionPage.site.categories[0].canCreateTopic = true;
  assert.equal(permissionPage.canSubmitResources, true);
  assert.equal(permissionPage.canSubmitCourses, true);
  permissionPage.currentUser = { moderator: true };
  assert.equal(permissionPage.canManageCourses, library);
  permissionPage.currentUser = { admin: true, academy_moderator_role: true };
  permissionPage.site.categories[0].canCreateTopic = false;
  assert.equal(permissionPage.canSubmitResources, true);
  assert.equal(permissionPage.canManageCourses, true);

  const permissionItem = new Item({
    library,
    resource: { id: 101, can_delete: true, link_only: true, files: [] },
  });
  permissionItem.site = permissionPage.site;
  permissionItem.currentUser = academyUser;
  assert.equal(permissionItem.canDelete, !library);
  assert.equal(permissionItem.canEdit, false);
  permissionItem.args.resource.can_delete = false;
  assert.equal(permissionItem.canDelete, false);

  const permissionDialog = new Dialog({ library });
  permissionDialog.site = permissionPage.site;
  permissionDialog.currentUser = academyUser;
  assert.equal(
    permissionDialog.shareLabel,
    library ? "isbf_v2.learning_apply_share" : "isbf_v2.learning_share"
  );
  assert.equal(
    permissionDialog.submitLabel,
    library ? "isbf_v2.learning_submit_request" : "isbf_v2.learning_share"
  );
  permissionDialog.args.resource = { id: 101, link_only: true, files: [] };
  assert.equal(permissionDialog.editAllowed, false);
}
const pageSource = read(
  "javascripts/discourse/components/isbf-resource-page.gjs"
);
assert.match(
  pageSource,
  /this.isLibrary\s*\? this.currentUser\?\.moderator\s*:/
);
assert.match(pageSource, /this.currentUser &&\s*this.canSubmitResources &&/);
assert.match(
  pageSource,
  /!this.selectedCourse \|\|\s*!this.canSubmitResources \|\|/
);
for (const name of [
  "isbf-resource-page",
  "isbf-resource-item",
  "isbf-resource-share-dialog",
]) {
  const permissionSource = read(`javascripts/discourse/components/${name}.gjs`);
  assert.match(
    permissionSource,
    /!this\.(?:args\.library|isLibrary) &&\s*this.currentUser\?\.academy_moderator_permissions\?\.manage_resources/
  );
}

console.log(
  "Library catalog, independent filters, stale requests, sharing, native edit/delete contracts and shared wrappers OK"
);
