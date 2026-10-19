import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
function componentClass(name, globals = {}) {
  const source = read(`javascripts/discourse/components/${name}.gjs`);
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
    services: {},
    URL,
    Intl,
    clearTimeout,
    setTimeout,
    themePrefix: (key) => key,
    i18n: (key) => key,
    document: { activeElement: { focus() {} } },
    get: (object, path) =>
      path.split(".").reduce((value, key) => value?.[key], object),
    ...globals,
  });
}

const requests = [];
const Page = componentClass("isbf-resource-page", {
  learningConfig: (site) => site?.isbf_learning,
  libraryConfig: (site) => site?.isbf_library,
  learningResourceQuery: (course_id, query, page) => ({ course_id, page }),
  ajax: (url, options) =>
    new Promise((resolve) => requests.push({ url, options, resolve })),
});
const page = new Page();
page.site = {
  isbf_learning: {
    category_id: 10,
    grades: [{ id: 1, label: "大一" }],
    link_sharing: true,
    resource_admin_management: true,
  },
};
page.currentUser = {};
page.courses = [{ id: "course-a", name: "微观经济学", grade: 1 }];
page.selectedCourseId = "course-a";
page.toggleContributions();
assert.equal(requests.at(-1).url, "/isbf/learning/contributions");
assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).options.data)), {
  page: 0,
});
const stale = requests.at(-1);
page.toggleContributions();
assert.equal(requests.at(-1).url, "/isbf/learning/resources");
stale.resolve({ resources: [{ id: 999 }], has_more: true });
await new Promise(setImmediate);
assert.equal(
  page.resources.length,
  0,
  "a late contribution response cannot replace the course list"
);
requests.at(-1).resolve({ resources: [{ id: 1 }], has_more: false });
await new Promise(setImmediate);
assert.equal(page.resources[0].id, 1);
page.currentUser = {
  academy_moderator_permissions: { manage_resources: true },
};
page.editCourse(page.courses[0]);
assert.equal(page.editingDirectory.entry.id, "course-a");
page.closeDirectoryEditor();
page.currentUser = {};
page.editCourse(page.courses[0]);
assert.equal(
  page.editingDirectory,
  null,
  "ordinary users cannot invoke course editing"
);

const lookupRequests = [];
const Dialog = componentClass("isbf-learning-management-dialog", {
  services: {
    currentUser: { academy_moderator_permissions: { manage_resources: true } },
  },
  ajax: (url, options) =>
    new Promise((resolve) => lookupRequests.push({ url, options, resolve })),
});
const dialog = new Dialog({ course: { id: "course-a" } });
let number;
dialog.changeStudentNumber("20260001", {
  set: (name, value) => {
    number = value;
  },
});
const lookup = dialog.lookupUsers();
dialog.changeStudentNumber("20260002", { set() {} });
lookupRequests[0].resolve({ users: [{ id: 77 }] });
await lookup;
assert.equal(
  dialog.users,
  null,
  "a response for an old student number cannot offer the wrong user"
);
assert.equal(number, "20260001");
assert.equal(dialog.associationRequired, true);
dialog.selectUser({ id: 88, username: "student" });
assert.equal(dialog.associationRequired, false);
dialog.changeStudentNumber("", { set() {} });
assert.equal(
  dialog.selectedUser,
  null,
  "clearing a student number clears the attribution"
);
assert.equal(dialog.associationRequired, false);
dialog.currentUser = {};
assert.equal(dialog.canManage, false);
dialog.siteSettings = {
  isbf_learning_collection_form_url: "https://forms.example.edu/collection",
};
assert.equal(
  dialog.collectionUrl,
  "https://forms.example.edu/collection",
  "the collection destination comes from the saved setting"
);
assert.match(read("locales/zh_CN.yml"), /你也想分享学习资料？/);
process.stdout.write(
  "Contribution switching, stale results, management permissions, student selection and WPS destination OK\n"
);
