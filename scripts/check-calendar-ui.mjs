import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const about = JSON.parse(readFileSync(new URL("about.json", root), "utf8"));
for (const icon of [
  "calendar-days",
  "table-cells-large",
  "chevron-left",
  "xmark",
  "ellipsis",
  "comment",
  "retweet",
  "heart",
  "bookmark",
  "chart-bar",
  "flag",
]) {
  if (!about.modifiers.svg_icons.includes(icon)) {
    throw new Error(`Missing sprite icon: ${icon}`);
  }
}

for (const locale of ["zh_CN", "en"]) {
  const yaml = readFileSync(new URL(`locales/${locale}.yml`, root), "utf8");
  for (const key of [
    "calendar",
    "workbench",
    "calendar_add_personal",
    "calendar_publish_event",
    "account_actions",
    "switch_account",
    "logout",
    "logout_confirm",
    "reply",
    "repost",
    "like",
    "views",
    "views_count",
    "report",
  ]) {
    if (!new RegExp(`^    ${key}:`, "m").test(yaml)) {
      throw new Error(`${locale} is missing ${key}`);
    }
  }
}

function checkDirectory(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      checkDirectory(path);
      continue;
    }
    if (!name.endsWith(".gjs") && !name.endsWith(".js")) {
      continue;
    }

    const source = readFileSync(path, "utf8");
    const stack = [];
    for (const match of source.matchAll(
      /\{\{([#/])(if|unless|each|let|component)(?:\s[^}]*)?\}\}/g
    )) {
      if (match[1] === "#") {
        stack.push(match[2]);
      } else if (stack.pop() !== match[2]) {
        throw new Error(`${path}: unbalanced template block ${match[2]}`);
      }
    }
    if (stack.length) {
      throw new Error(`${path}: unclosed template block`);
    }

    const js = source
      .replace(
        /export default <template>[\s\S]*?<\/template>/g,
        "export default null;"
      )
      .replace(/<template>[\s\S]*?<\/template>/g, "")
      .replace(/@(service|tracked|cached|action|bind)\s+/g, "")
      .replace(/@(computed|alias)\([^)]*\)\s*/g, "");
    const module = new vm.SourceTextModule(js, { identifier: path });
    assert.equal(module.status, "unlinked");
  }
}

checkDirectory(fileURLToPath(new URL("javascripts/discourse", root)));
process.stdout.write(
  "Theme metadata, localization, template blocks and JavaScript syntax OK\n"
);
