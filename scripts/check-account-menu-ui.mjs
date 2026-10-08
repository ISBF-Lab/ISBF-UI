import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");
const requests = [];
class Component {
  constructor(_owner, args = {}) {
    this.args = args;
  }

  willDestroy() {}
}
class LinkModal {}
const defaults = {
  default: {},
  tracked() {},
  action() {},
  service() {},
  on() {},
  fn() {},
  eq() {},
  or() {},
  themePrefix: (key) => key,
  i18n: (key) => key,
};
async function load(path) {
  const text = source(path)
    .replace(/<template>[\s\S]*?<\/template>/g, "")
    .replace(/@(tracked|action|service)\s+/g, "");
  const module = new vm.SourceTextModule(text);
  await module.link((name) => {
    const values =
      name === "@glimmer/component"
        ? { default: Component }
        : name === "./isbf-v2-account-link-modal"
          ? { default: LinkModal }
          : name === "discourse/lib/ajax"
            ? {
                ajax: (url, options) =>
                  new Promise((resolve, reject) =>
                    requests.push({ url, options, resolve, reject }),
                  ),
              }
            : name === "discourse/lib/push-notifications"
              ? { getCurrentPushSubscription() {} }
              : defaults;
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) {
        this.setExport(key, value);
      }
    });
  });
  await module.evaluate();
  return module.namespace.default;
}
const events = [];
globalThis.document = { addEventListener() {}, removeEventListener() {} };
const Menu = await load(
  "javascripts/discourse/components/isbf-v2-account-menu.gjs",
);
const menu = new Menu(null, { mobile: true });
menu.modal = {
  show(component) {
    assert.equal(menu.isOpen, false);
    assert.equal(component, LinkModal);
    events.push("open");
  },
};
const originalClose = menu.closeMenu.bind(menu);
menu.closeMenu = () => {
  events.push("close");
  originalClose();
};
menu.openLinkModal();
assert.deepEqual(events, []);
const trigger = {
  currentTarget: { closest: () => ({ contains: () => false }) },
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const links = [
  { id: 1, status: "approved" },
  { id: 2, status: "pending_admin" },
];
async function refresh(response) {
  originalClose();
  menu.toggleMenu(trigger);
  assert.equal(menu.canLinkAccounts, false);
  assert.equal(menu.canSwitchAccounts, false);
  assert.deepEqual(menu.activeLinks, []);
  requests.at(-1).resolve(response);
  await tick();
}
for (const value of [undefined, false, "true", 1]) {
  await refresh({
    links,
    can_link_accounts: value,
    can_switch_accounts: value,
  });
  assert.equal(menu.canLinkAccounts, false);
  assert.equal(menu.canSwitchAccounts, false);
  assert.deepEqual(menu.activeLinks, []);
}
await refresh({ links, can_link_accounts: false, can_switch_accounts: true });
assert.deepEqual(menu.activeLinks, links);
menu.openLinkModal();
assert.deepEqual(events, []);
await refresh({ links, can_link_accounts: true, can_switch_accounts: false });
assert.deepEqual(menu.activeLinks, []);
menu.openLinkModal();
assert.deepEqual(events, ["close", "open"]);
assert.equal(
  source("javascripts/discourse/components/isbf-v2-account-menu.gjs").includes(
    "{{#if this.canLinkAccounts}}",
  ),
  true,
);
menu.toggleMenu(trigger);
requests.at(-1).reject({ jqXHR: { status: 404 } });
await tick();
assert.equal(menu.canLinkAccounts, false);
assert.deepEqual(menu.activeLinks, []);
await menu.switchAccount({ id: 1, device_authorized: true });
const beforeVerify = requests.length;
await menu.verifyAndSwitch({ id: 1 }, { preventDefault() {} });
assert.equal(requests.length, beforeVerify);
originalClose();
menu.toggleMenu(trigger);
const stale = requests.at(-1);
originalClose();
menu.toggleMenu(trigger);
requests
  .at(-1)
  .resolve({ links: [], can_link_accounts: false, can_switch_accounts: false });
stale.resolve({ links, can_link_accounts: true, can_switch_accounts: true });
await tick();
assert.equal(menu.canLinkAccounts, false);
originalClose();
menu.toggleMenu(trigger);
menu.willDestroy();
requests
  .at(-1)
  .resolve({ links, can_link_accounts: true, can_switch_accounts: true });
await tick();
assert.equal(menu.canLinkAccounts, false);

const Modal = await load(
  "javascripts/discourse/components/isbf-v2-account-link-modal.gjs",
);
let closed = 0;
const alerts = [];
const modal = new Modal(null, { closeModal: () => closed++ });
modal.dialog = { alert: (message) => alerts.push(message) };
const event = { preventDefault() {} };
await modal.submit(event);
modal.username = "  target  ";
const count = requests.length;
const failed = modal.submit(event);
assert.equal(modal.isSubmitting, true);
await modal.submit(event);
assert.equal(requests.length, count + 1);
assert.equal(requests.at(-1).url, "/isbf/account-switch/links");
assert.deepEqual(requests.at(-1).options, {
  type: "POST",
  data: { username: "target" },
});
requests.at(-1).reject({ jqXHR: { responseJSON: { errors: ["Retry"] } } });
await failed;
assert.equal(modal.username, "  target  ");
assert.equal(modal.errorMessage, "Retry");
assert.equal(modal.isSubmitting, false);
assert.equal(closed, 0);
const success = modal.submit(event);
requests.at(-1).resolve({});
await success;
assert.equal(closed, 1);
assert.deepEqual(alerts, ["isbf_v2.account_link_sent"]);
const closeDismissed = () => closed++;
for (const finish of ["resolve", "reject"]) {
  const dismissed = new Modal(null, { closeModal: closeDismissed });
  dismissed.dialog = modal.dialog;
  dismissed.username = "target";
  const pending = dismissed.submit(event);
  dismissed.close();
  dismissed.willDestroy();
  requests.at(-1)[finish]({});
  await pending;
  assert.equal(dismissed.errorMessage, null);
  assert.equal(alerts.length, 1);
}
const modalSource = source(
  "javascripts/discourse/components/isbf-v2-account-link-modal.gjs",
);
assert.match(modalSource, /<DModal/);
assert.match(modalSource, /@closeModal={{this.close}}/);
assert.match(modalSource, /@label="cancel"/);
process.stdout.write(
  "Account modal ordering, strict capabilities, loading/error/stale guards, duplicate submit, retry and close/destroy requests OK\n",
);
