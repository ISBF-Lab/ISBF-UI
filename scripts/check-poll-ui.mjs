import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const source = (path) =>
  readFileSync(new URL(path, root), "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");
const text = source("javascripts/discourse/api-initializers/isbf-poll.js");
const nativeBuilder = {};
let available = nativeBuilder;
let initializer;
const dependencies = {
  "virtual:theme": { themePrefix: (key) => `theme.${key}` },
  "discourse/lib/api": {
    apiInitializer: (callback) => {
      initializer = callback;
      return callback;
    },
  },
  "discourse/lib/utilities": {
    optionalRequire: (path) => {
      assert.equal(
        path,
        "discourse/plugins/poll/discourse/components/modal/poll-ui-builder"
      );
      if (available instanceof Error) {
        throw available;
      }
      return available;
    },
  },
  "discourse-i18n": { i18n: (key) => key },
};
const module = new vm.SourceTextModule(text);
await module.link((name) => {
  const values = dependencies[name];
  assert.ok(values, `Unexpected dependency: ${name}`);
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) {
      this.setExport(key, value);
    }
  });
});
await module.evaluate();

const settings = { poll_enabled: true, poll_create_allowed_groups: "11" };
const composer = { model: { topic: {} } };
let user = { staff: false, can_create_poll: true };
const calls = [];
const callbacks = [];
let closePoll;
const modal = {
  activeModal: null,
  show: (...args) => {
    calls.push(args);
    return new Promise((resolve) => {
      closePoll = resolve;
    });
  },
};
const services = {
  "service:site-settings": settings,
  "service:composer": composer,
  "service:modal": modal,
};
const api = {
  container: {
    lookup: (name) => {
      assert.ok(services[name]);
      return services[name];
    },
  },
  getCurrentUser: () => user,
  onToolbarCreate: (callback) => callbacks.push(callback),
};
initializer(api);
initializer(api);
assert.equal(
  callbacks.length,
  1,
  "Initializer cannot register duplicate callbacks"
);
const buttons = [];
const toolbar = { addButton: (button) => buttons.push(button) };
callbacks[0](toolbar);
callbacks[0](toolbar);
assert.equal(buttons.length, 1, "A toolbar gets one direct Poll button");
const button = buttons[0];
assert.equal(button.id, "isbf-poll");
assert.equal(button.group, "extras");
assert.equal(button.icon, "chart-bar");
assert.equal(button.translatedLabel, "theme.isbf_v2.poll_button");
assert.equal(button.title, "theme.isbf_v2.poll_button_title");
assert.equal(button.condition(), true);
settings.poll_enabled = false;
assert.equal(button.condition(), false);
button.sendAction({});
assert.equal(calls.length, 0);
settings.poll_enabled = true;
for (const candidate of [null, { staff: false, can_create_poll: false }]) {
  user = candidate;
  assert.equal(button.condition(), false);
  button.sendAction({});
}
assert.equal(calls.length, 0);
user = { staff: true, can_create_poll: false };
assert.equal(button.condition(), true);
user = null;
composer.model.topic.pm_with_non_human_user = true;
assert.equal(button.condition(), true, "Preserve native bot PM exception");
settings.poll_enabled = false;
assert.equal(
  button.condition(),
  false,
  "Bot PM cannot override disabled polls"
);
settings.poll_enabled = true;
composer.model.topic = {};
user = { can_create_poll: true };
for (const missing of [false, null, new Error("Plugin unavailable")]) {
  available = missing;
  assert.equal(button.condition(), false);
  button.sendAction({});
}
assert.equal(calls.length, 0);
available = nativeBuilder;
button.sendAction(undefined);
assert.equal(calls.length, 0);
const insertion = [];
const event = {
  selected: { start: 7, end: 12, value: "draft" },
  commands: { insertPoll: (value) => insertion.push(value) },
  addText: (value) => insertion.push(value),
};
const before = JSON.stringify(event.selected);
modal.activeModal = { component: nativeBuilder };
await button.sendAction(event);
assert.equal(
  calls.length,
  0,
  "Do not replace an already open native Poll builder"
);
modal.activeModal = null;
const composerModel = composer.model;
for (const staleModel of [
  null,
  { isDestroyed: true },
  { isDestroying: true },
]) {
  composer.model = staleModel;
  assert.equal(button.condition(), false);
  await button.sendAction(event);
}
assert.equal(
  calls.length,
  0,
  "Closed/destroying composer cannot open Poll builder"
);
composer.model = composerModel;
composer.model.category = { id: 42 };
const opened = button.sendAction(event);
await button.sendAction(event);
assert.equal(
  calls.length,
  1,
  "Guard repeat clicks before native modal becomes active"
);
assert.equal(calls.length, 1);
assert.equal(calls[0][0], nativeBuilder);
assert.equal(
  calls[0][1].model.toolbarEvent,
  event,
  "Forward original native event by identity"
);
assert.equal(JSON.stringify(event.selected), before);
assert.equal(
  insertion.length,
  0,
  "Opening builder does not insert or rewrite draft"
);
calls[0][1].model.toolbarEvent.commands.insertPoll("native rich poll");
calls[0][1].model.toolbarEvent.addText("native markdown poll");
assert.deepEqual(insertion, ["native rich poll", "native markdown poll"]);
closePoll();
await opened;
const reopened = button.sendAction(event);
assert.equal(calls.length, 2, "Closing native modal permits reopening");
closePoll();
await reopened;
assert.equal(settings.poll_create_allowed_groups, "11");
const anotherToolbar = [];
callbacks[0]({ addButton: (value) => anotherToolbar.push(value) });
assert.equal(
  anotherToolbar.length,
  1,
  "Recreated toolbar receives Poll button"
);

assert.doesNotMatch(
  text,
  /import .*poll-ui-builder|registerRichEditorExtension|addComposerToolbarPopupMenuOption|\.reply\s*=/
);
const styles = source("stylesheets/poll.scss");
assert.match(styles, /min-height: 44px/);
assert.match(styles, /min-width: 44px/);
assert.match(styles, /focus-visible/);
assert.match(styles, /\.d-icon,[\s\S]*\.d-button-label/);
assert.match(styles, /width: var\(--isbf-v2-feed-width\)/);
assert.match(styles, /margin-inline: var\(--isbf-v2-feed-left\) auto/);
assert.match(styles, /env\(safe-area-inset-bottom\)/);
assert.doesNotMatch(
  styles.split(".isbf-poll-previews")[0],
  /overflow:\s*hidden|\.d-editor-button-bar\s*\{|display:\s*none/
);
for (const locale of ["en", "zh_CN"]) {
  const contents = source(`locales/${locale}.yml`);
  for (const key of ["poll_button", "poll_button_title"]) {
    assert.match(
      contents,
      new RegExp(`^    ${key}: ".+"$`, "m"),
      `${locale} missing ${key}`
    );
  }
}
assert.match(source("common/common.scss"), /@import "poll";/);
assert.ok(
  JSON.parse(source("about.json")).modifiers.svg_icons.includes("chart-bar")
);
process.stdout.write(
  "Poll native toolbar, permission parity, optional plugin, duplicate registration, event identity and insertion context checks OK\n"
);

assert.match(
  styles,
  /\.btn,\s*\.select-kit-header,[\s\S]*?min-height: 44px;/,
  "Native Poll controls retain a 44px touch height"
);
