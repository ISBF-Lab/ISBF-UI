import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({});
const owners = new WeakMap();
let starts = 0;
class BackNavigation {
  constructor() {
    starts++;
  }
}
const modules = {
  "@ember/owner": { getOwner: (instance) => owners.get(instance) },
  "discourse/lib/api": { apiInitializer: (initialize) => initialize },
  "../services/isbf-back-navigation": { default: BackNavigation },
};
const initializer = new vm.SourceTextModule(
  readFileSync(
    new URL(
      "../javascripts/discourse/api-initializers/isbf-back-navigation.js",
      import.meta.url
    ),
    "utf8"
  ),
  { context }
);
await initializer.link((specifier) => {
  const exports = modules[specifier];
  assert.ok(exports, `Unexpected initializer dependency: ${specifier}`);
  return new vm.SyntheticModule(
    Object.keys(exports),
    function () {
      for (const [key, value] of Object.entries(exports)) {
        this.setExport(key, value);
      }
    },
    { context }
  );
});
await initializer.evaluate();
const initialize = initializer.namespace.default;

function application(existingFactory) {
  const router = {};
  const factories = new Map();
  const instances = new Map();
  const registrations = [];
  const key = "service:isbf-back-navigation";
  if (existingFactory) {
    factories.set(key, existingFactory);
  }
  const owner = {
    hasRegistration(name) {
      assert.equal(this, owner);
      return factories.has(name);
    },
    register(name, factory) {
      assert.equal(this, owner);
      assert.equal(
        instances.has(name),
        false,
        "Never re-register a live service"
      );
      registrations.push(name);
      factories.set(name, factory);
    },
    lookup(name) {
      assert.equal(this, owner);
      assert.equal(name, key);
      assert.ok(
        factories.has(name),
        "Register before eagerly starting the service"
      );
      if (!instances.has(name)) {
        const Factory = factories.get(name);
        instances.set(name, new Factory());
      }
      return instances.get(name);
    },
  };
  owners.set(router, owner);
  const container = Object.freeze({
    lookup(name) {
      assert.equal(this, container);
      assert.equal(name, "service:router");
      return router;
    },
  });
  assert.equal(container.register, undefined);
  return { api: { container }, owner, registrations, key };
}

const first = application();
assert.doesNotThrow(() => initialize(first.api));
assert.equal(starts, 1, "Startup eagerly instantiates the navigation service");
const instance = first.owner.lookup(first.key);
initialize(first.api);
assert.equal(first.owner.lookup(first.key), instance);
assert.equal(
  starts,
  1,
  "Repeated initialization keeps the singleton and listeners"
);
assert.deepEqual(first.registrations, [first.key]);

const second = application();
initialize(second.api);
assert.notEqual(second.owner.lookup(second.key), instance);
assert.equal(
  starts,
  2,
  "Separate application owners have independent navigation"
);

class ExistingNavigation {}
const existing = application(ExistingNavigation);
initialize(existing.api);
assert.equal(existing.registrations.length, 0);
assert.ok(existing.owner.lookup(existing.key) instanceof ExistingNavigation);
process.stdout.write(
  "Back navigation initializes through Owner with a lookup-only container, preserves existing registrations and starts once per application\n"
);
