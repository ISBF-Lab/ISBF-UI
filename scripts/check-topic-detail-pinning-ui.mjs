import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL(
    "../javascripts/discourse/components/isbf-topic-more.gjs",
    import.meta.url
  ),
  "utf8"
);
const body = source
  .slice(source.indexOf("export default class"), source.indexOf("  <template>"))
  .replace("export default ", "")
  .replace(/^\s*@service \w+;\s*$/gm, "")
  .replace(/^\s*@(tracked|action)\s*/gm, "");
const saves = [];
const modals = [];
const errors = [];
const events = [];
let saveFailure;
let resolveSave;
const More = vm.runInNewContext(`${body}}\nISBFTopicMore`, {
  Component: class {
    constructor(args) {
      this.args = args;
    }
  },
  Date,
  pinningMeta: (topic) => topic?.isbf_home_pinning,
  ISBFHomePinDialog: class {},
  themePrefix: (key) => key,
  i18n: (key) => key,
  async saveHomePin(...args) {
    saves.push(args);
    if (saveFailure) {
      throw saveFailure;
    }
    await new Promise((resolve) => (resolveSave = resolve));
    args[0].isbf_home_pinning = { can_manage: true, active: false };
  },
});
function component() {
  const instance = new More({
    post: {
      id: 91,
      post_number: 1,
      topic: { id: 12, isbf_home_pinning: { can_manage: true, active: true } },
    },
  });
  Object.assign(instance, {
    site: { isbf_pinning: { enabled: true, home_actions_enabled: true } },
    currentUser: { admin: true },
    modal: { show: (...args) => modals.push(args) },
    dialog: { alert: (message) => errors.push(message) },
    appEvents: { trigger: (name) => events.push(name) },
  });
  instance.onHomePinSaved = instance.onHomePinSaved.bind(instance);
  return instance;
}

const more = component();
for (const user of [null, {}, { staff: true }, { moderator: true }]) {
  more.currentUser = user;
  assert.equal(more.canManageHomePin, false, "Admin required");
  await more.openHomePin();
  await more.cancelHomePin();
}
assert.equal(modals.length, 0);
assert.equal(saves.length, 0);
more.currentUser = { admin: true };
for (const key of ["enabled", "home_actions_enabled"]) {
  more.site.isbf_pinning[key] = false;
  assert.equal(more.canManageHomePin, false, `${key} required`);
  more.site.isbf_pinning[key] = true;
}
for (const metadata of [undefined, {}, { can_manage: false }]) {
  more.args.post.topic.isbf_home_pinning = metadata;
  assert.equal(more.canManageHomePin, false, "Server permission required");
}
more.args.post.topic.isbf_home_pinning = { can_manage: true, active: true };
more.args.post.post_number = 2;
assert.equal(more.canManageHomePin, false, "Replies cannot manage topic pins");
more.args.post.post_number = 1;
assert.equal(more.canManageHomePin, true, "Topic details need no feed route");

let closeMenu;
more.registerMenu({
  close: () => new Promise((resolve) => (closeMenu = resolve)),
});
const opening = more.openHomePin();
await more.openHomePin();
assert.equal(more.isPinning, true);
assert.equal(modals.length, 0, "Modal waits for menu close");
closeMenu();
await opening;
assert.equal(modals.length, 1, "Repeated click opens one modal");
assert.equal(modals[0][1].model.topic, more.args.post.topic);
modals[0][1].model.onSaved();
assert.equal(events.at(-1), "isbf:home-pin-saved");
assert.equal(more.isPinning, false);

more.registerMenu({ close: async () => {} });
const cancelling = more.cancelHomePin();
await Promise.resolve();
await more.cancelHomePin();
assert.equal(saves.length, 1, "Repeated cancel saves once");
assert.equal(saves[0][0], more.args.post.topic);
assert.equal(saves[0][1].enabled, false);
resolveSave();
await cancelling;
assert.equal(more.showHomePin, false, "Shared save updates topic metadata");
assert.equal(more.isPinning, false);

more.args.post.topic.isbf_home_pinning.active = true;
saveFailure = { jqXHR: { responseJSON: { errors: ["Denied"] } } };
await more.cancelHomePin();
assert.equal(errors.at(-1), "Denied");
assert.equal(more.isPinning, false, "API failure allows retry");
assert.equal(more.showHomePin, true, "API failure retains metadata");
saveFailure = null;

for (const operation of ["openHomePin", "cancelHomePin"]) {
  const destroyed = component();
  let finishClose;
  destroyed.registerMenu({
    close: () => new Promise((resolve) => (finishClose = resolve)),
  });
  const pending = destroyed[operation]();
  destroyed.isDestroying = true;
  const modalCount = modals.length;
  const saveCount = saves.length;
  finishClose();
  await pending;
  assert.equal(modals.length, modalCount, "No late modal after destruction");
  assert.equal(saves.length, saveCount, "No save after destruction");
}
const revoked = component();
revoked.registerMenu({ close: async () => (revoked.currentUser = null) });
await revoked.cancelHomePin();
assert.equal(saves.length, 2, "Permission checked again after menu close");

assert.doesNotMatch(source, /isPinningContext/);
assert.match(source, /secondaryMenuFor\(this.args.post\)/);
assert.match(source, /<PostMenuButtonWrapper/);
assert.match(source, /editPost: this.editPost/);
assert.match(source, /fn this.showTopicInfo menu/);
for (const action of ["openHomePin", "cancelHomePin"]) {
  assert.match(
    source,
    new RegExp(`@action={{this.${action}}}\\s+@disabled={{this.isPinning}}`)
  );
}
for (const label of ["pin", "pin_update", "pin_cancel"]) {
  assert.ok(source.includes(`"isbf_v2.${label}"`));
}
process.stdout.write("Topic detail pinning UI checks passed\n");
