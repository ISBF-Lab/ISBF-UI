import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve as resolvePath } from "node:path";
import process from "node:process";
import vm from "node:vm";

const tools = createRequire(
  resolvePath(process.argv[2] || ".", "package.json")
);
const { JSDOM } = tools("jsdom");
const dom = new JSDOM(`<main>
  <div class="user-profile-names"><div class="username primary">member</div><div class="full-name">Name</div><span id="profile-anchor"></span></div>
  <div class="names"><div class="names__primary full-name">Name</div><span class="username names__secondary">member</span><span id="card-anchor"></span></div>
  <div class="name-line"><a><span class="username">member</span></a><span id="info-anchor"></span></div>
  <div class="avatar-only"><a data-user-card="member"><img></a><span id="avatar-anchor"></span></div>
  <section class="search-advanced"><div class="search-results"><span id="search-anchor"></span><div class="user-items"><a class="fps-user-item" data-user-card="Member"><img><div class="user-titles"><span class="username">Member</span></div></a></div></div></section>
  <section class="search-advanced"><div class="user-items"><a class="fps-user-item" data-user-card="Member"><div class="user-titles"><span class="username">other section</span></div></a></div></section>
  <section class="search-result-user"><span id="dropdown-anchor"></span><ul class="list"><li><a class="search-link" href="/u/Member"><img><div class="user-titles"><span class="username">Member</span></div></a></li></ul></section>
</main>`);
const document = dom.window.document;
const root = new URL("../", import.meta.url);
const targetsModule = new vm.SourceTextModule(
  readFileSync(
    new URL("javascripts/discourse/lib/alumni-label-targets.js", root),
    "utf8"
  )
);
await targetsModule.link(() => {});
await targetsModule.evaluate();
const { nativeAlumniTarget, searchAlumniTargets } = targetsModule.namespace;
for (const id of ["profile", "card", "info"]) {
  const anchor = document.getElementById(`${id}-anchor`);
  const target = nativeAlumniTarget(anchor);
  assert.equal(target.textContent, "member");
  assert.equal(target.classList.contains("username"), true);
}
assert.equal(
  nativeAlumniTarget(document.getElementById("avatar-anchor")),
  null
);
const user = { id: 12, username: "member", path: "/u/member" };
const searchAnchor = document.getElementById("search-anchor");
const firstTarget = searchAlumniTargets(searchAnchor, [user], false)[0];
assert.equal(firstTarget.user, user);
assert.equal(firstTarget.target.textContent, "Member");
assert.equal(
  firstTarget.target.closest(".search-advanced"),
  searchAnchor.closest(".search-advanced")
);
assert.equal(
  searchAlumniTargets(searchAnchor, [{ ...user, username: "absent" }], false)
    .length,
  0
);
const oldTarget = firstTarget.target;
oldTarget.outerHTML = '<span class="username">replacement</span>';
const replacement = searchAlumniTargets(searchAnchor, [user], false)[0].target;
assert.notEqual(replacement, oldTarget);
assert.equal(oldTarget.isConnected, false);
assert.equal(replacement.textContent, "replacement");
assert.equal(
  searchAlumniTargets(
    document.getElementById("dropdown-anchor"),
    [user],
    true
  )[0].target.textContent,
  "Member"
);
assert.equal(
  searchAlumniTargets(document.getElementById("avatar-anchor"), [user], true)
    .length,
  0
);

const pending = [];
const actor = { id: 1 };
class Service {
  constructor() {
    this.currentUser = actor;
    this.site = { isbf_alumni: { enabled: true } };
    this.siteSettings = { isbf_alumni_enabled: true };
  }

  willDestroy() {
    this.isDestroyed = true;
  }
}
const context = vm.createContext({ document, queueMicrotask });
const engine = new vm.SourceTextModule(
  readFileSync(
    new URL("javascripts/discourse/lib/alumni-identities.js", root),
    "utf8"
  ),
  { context }
);
await engine.link(() => {});
await engine.evaluate();
const serviceSource = readFileSync(
  new URL("javascripts/discourse/services/isbf-alumni-identity.js", root),
  "utf8"
)
  .replace(/@service\s+\w+;\s*/g, "")
  .replace(/@tracked\s+/g, "");
const serviceModule = new vm.SourceTextModule(serviceSource, { context });
await serviceModule.link((name) => {
  if (name === "../lib/alumni-identities") {
    return engine;
  }
  const values =
    name === "discourse/lib/ajax"
      ? {
          ajax: (_url, options) =>
            new Promise((resolve, reject) =>
              pending.push({ resolve, reject, options })
            ),
        }
      : { default: Service, service() {}, tracked() {} };
  return new vm.SyntheticModule(
    Object.keys(values),
    function () {
      Object.entries(values).forEach(([key, value]) =>
        this.setExport(key, value)
      );
    },
    { context }
  );
});
await serviceModule.evaluate();
const identity = new serviceModule.namespace.default();
const userId = { id: 12 };
const tick = () => new Promise((resolve) => setImmediate(resolve));
identity.watch(userId);
await tick();
pending.shift().resolve({ memberships: { 12: true } });
await tick();
assert.equal(identity.isMember(userId), true);
delete identity.site.isbf_alumni;
assert.equal(
  identity.isMember(userId),
  true,
  "basic site bootstrap needs no geography data for identity labels"
);
identity.unwatch(12);
assert.equal(
  identity.isMember(userId),
  false,
  "a detached user's last snapshot is never reused as current truth"
);
identity.watch(userId);
await tick();
pending.shift().reject(new Error("offline"));
await tick();
assert.equal(identity.isMember(userId), false);
identity.refresh();
await tick();
pending.shift().resolve({ memberships: { 12: true } });
await tick();
identity.currentUser = { id: 2 };
assert.equal(
  identity.isMember(userId),
  false,
  "switching account hides old state before any observer runs"
);
identity.synchronizeAccount();
await tick();
pending.shift().resolve({ memberships: { 12: false } });
await tick();
assert.equal(identity.isMember(userId), false);
identity.siteSettings.isbf_alumni_enabled = false;
identity.refresh();
await tick();
assert.equal(pending.length, 0, "disabled feature sends no requests");
identity.willDestroy();
dom.window.close();
process.stdout.write(
  "Alumni native username scoping, search replacement, avatar exclusion, account ownership and stale snapshots OK\n"
);
