import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
import vm from "node:vm";

const source = new vm.SourceTextModule(
  readFileSync(
    new URL(
      "../javascripts/discourse/lib/alumni-identities.js",
      import.meta.url
    ),
    "utf8"
  )
);
await source.link(() => {});
await source.evaluate();
const {
  default: AlumniIdentities,
  alumniUserId,
  MAX_IDENTITY_BATCH,
} = source.namespace;

const settle = () => new Promise((resolve) => setImmediate(resolve));
const memberships = (ids, value = true) => ({
  memberships: Object.fromEntries(ids.map((id) => [id, value])),
});

function harness() {
  const calls = [];
  let changes = 0;
  const identities = new AlumniIdentities({
    request(ids) {
      return new Promise((resolve, reject) => {
        calls.push({ ids: [...ids], resolve, reject });
      });
    },
    changed() {
      changes++;
    },
  });
  return {
    identities,
    calls,
    get changes() {
      return changes;
    },
  };
}

for (const [value, expected] of [
  [1, 1],
  [2147483647, 2147483647],
  ["1", 1],
  ["2147483647", 2147483647],
]) {
  assert.equal(alumniUserId({ id: value }), expected);
}
for (const id of [
  undefined,
  null,
  false,
  true,
  0,
  -1,
  1.5,
  NaN,
  Infinity,
  2147483648,
  "",
  "0",
  "-1",
  "01",
  " 1",
  "1 ",
  "+1",
  "1.0",
  "1e2",
  "2147483648",
  "12345678901",
  [],
  {},
]) {
  assert.equal(alumniUserId({ id }), null, `Reject invalid ID ${String(id)}`);
}
for (const user of [
  null,
  undefined,
  {},
  { username: "alumni" },
  { username: "123" },
  { user_id: 123, username: "alumni" },
  { id: 0, username: "123" },
]) {
  assert.equal(alumniUserId(user), null, "Never infer an ID from account text");
}
assert.equal(MAX_IDENTITY_BATCH, 100);

{
  const { identities, calls } = harness();
  identities.watch(7);
  identities.watch(7);
  identities.watch(8);
  assert.equal(calls.length, 0, "Collect watches until the microtask boundary");
  await settle();
  assert.deepEqual(
    calls.map((call) => call.ids),
    [[7, 8]]
  );
  identities.watch(7);
  identities.watch(9);
  await settle();
  assert.equal(
    calls.length,
    1,
    "Wait for the active request before the next batch"
  );
  calls[0].resolve(memberships([7, 8]));
  await settle();
  assert.deepEqual(
    calls.map((call) => call.ids),
    [[7, 8], [9]]
  );
  calls[1].resolve(memberships([9]));
  await settle();
  assert.equal(identities.snapshot().size, 3);
  assert.equal(identities.isMember(7), true);
  identities.unwatch(7);
  identities.unwatch(7);
  assert.equal(
    identities.isMember(7),
    true,
    "Keep data while one consumer remains"
  );
  identities.unwatch(7);
  identities.unwatch(8);
  identities.unwatch(9);
  assert.equal(
    identities.snapshot().size,
    0,
    "Release data after the final unwatch"
  );
  identities.refresh();
  await settle();
  assert.equal(calls.length, 2, "An empty page must not request identities");
  identities.destroy();
}

{
  const { identities, calls } = harness();
  const ids = Array.from(
    { length: MAX_IDENTITY_BATCH * 2 + 5 },
    (_, i) => i + 1
  );
  ids.forEach((id) => identities.watch(id));
  await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ids, ids.slice(0, 100));
  await settle();
  assert.equal(calls.length, 1, "Never run batch chunks concurrently");
  calls[0].resolve(memberships(calls[0].ids));
  await settle();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].ids, ids.slice(100, 200));
  calls[1].resolve(memberships(calls[1].ids));
  await settle();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].ids, ids.slice(200));
  calls[2].resolve(memberships(calls[2].ids));
  await settle();
  assert.equal(identities.snapshot().size, ids.length);
  identities.destroy();
}

{
  const { identities, calls } = harness();
  for (let id = 1; id <= 6; id++) {
    identities.watch(id);
  }
  await settle();
  calls[0].resolve({
    memberships: { 1: true, 2: false, 3: "true", 4: 1, 5: null, 999: true },
  });
  await settle();
  assert.equal(identities.isMember(1), true);
  assert.equal(identities.isMember(2), false);
  assert.equal(
    identities.snapshot().get(2),
    false,
    "Retain explicit non-membership"
  );
  for (const id of [3, 4, 5, 6, 999]) {
    assert.equal(identities.isMember(id), false);
    assert.equal(
      identities.snapshot().has(id),
      false,
      "Malformed or absent stays unknown"
    );
  }
  const snapshot = identities.snapshot();
  snapshot.set(2, true);
  assert.equal(
    identities.isMember(2),
    false,
    "Snapshots cannot mutate live membership"
  );
  identities.refresh();
  assert.equal(identities.snapshot().size, 0);
  await settle();
  calls[1].resolve(null);
  await settle();
  assert.equal(
    identities.snapshot().size,
    0,
    "A missing response is not a negative cache"
  );
  identities.destroy();
}

{
  const state = harness();
  const { identities, calls } = state;
  identities.watch(21);
  await settle();
  calls[0].reject(new Error("Temporary read failure"));
  await settle();
  assert.equal(identities.snapshot().size, 0);
  assert.equal(state.changes, 0);
  assert.equal(calls.length, 1, "A failed read does not spin in a retry loop");
  identities.refresh();
  await settle();
  assert.deepEqual(calls[1].ids, [21]);
  calls[1].resolve(memberships([21]));
  await settle();
  assert.equal(identities.isMember(21), true, "Refresh retries a failed read");
  identities.destroy();
}

{
  const state = harness();
  const { identities, calls } = state;
  identities.watch(31);
  await settle();
  identities.refresh();
  await settle();
  assert.equal(
    calls.length,
    2,
    "Refresh starts a new generation while an old read waits"
  );
  const changesAfterRefresh = state.changes;
  calls[0].resolve(memberships([31]));
  await settle();
  assert.equal(identities.snapshot().size, 0);
  assert.equal(
    state.changes,
    changesAfterRefresh,
    "Ignore stale response notifications"
  );
  identities.watch(32);
  await settle();
  assert.equal(
    calls.length,
    2,
    "Old completion cannot release the new request's lock"
  );
  calls[1].resolve(memberships([31], false));
  await settle();
  assert.deepEqual(calls[2].ids, [32]);
  calls[2].resolve(memberships([32]));
  await settle();
  assert.equal(identities.snapshot().get(31), false);
  assert.equal(identities.isMember(32), true);
  identities.destroy();
}

{
  const { identities, calls } = harness();
  identities.watch(41);
  identities.unwatch(41);
  await settle();
  assert.equal(calls.length, 0, "Unmount before flush cancels queued work");
  identities.watch(42);
  identities.watch(43);
  await settle();
  identities.unwatch(42);
  calls[0].resolve(memberships([42, 43]));
  await settle();
  assert.equal(
    identities.snapshot().has(42),
    false,
    "Ignore results for an unmounted user"
  );
  assert.equal(identities.isMember(43), true);
  identities.unwatch(43);
  assert.equal(identities.snapshot().size, 0);
  identities.destroy();
}

{
  const state = harness();
  const { identities, calls } = state;
  identities.watch(51);
  await settle();
  identities.watch(52);
  identities.destroy();
  calls[0].resolve(memberships([51]));
  await settle();
  assert.equal(identities.snapshot().size, 0);
  assert.equal(
    state.changes,
    0,
    "Destruction suppresses old response notifications"
  );
  assert.equal(calls.length, 1, "Destruction drops the queued next batch");
}

{
  const { identities, calls } = harness();
  identities.watch(61);
  identities.destroy();
  await settle();
  assert.equal(calls.length, 0, "Destruction cancels a scheduled first flush");
}

process.stdout.write(
  "Alumni identity IDs, batching, bounded sequential chunks, unknown/failure handling, refresh generations and watcher cleanup OK\n"
);
