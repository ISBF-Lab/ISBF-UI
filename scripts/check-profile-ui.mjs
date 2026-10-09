import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../common/common.scss", import.meta.url),
  "utf8",
);
const selector =
  /body:has\(\.isbf-v2-shell--profile\)\s+#main-outlet\s+\.user-main\s+\.about:not\(\.collapsed-info\)\s*\{/g;
const matches = [...source.matchAll(selector)];
assert.equal(
  matches.length,
  1,
  "Expanded profile layout must have one scoped override",
);
const start = matches[0].index;
const opening = source.indexOf("{", start);
let depth = 1;
let end = opening + 1;
while (depth && end < source.length) {
  const character = source[end++];
  if (character === "{") {
    depth++;
  } else if (character === "}") {
    depth--;
  }
}
assert.equal(depth, 0, "Profile override must be balanced");
const profile = source.slice(opening + 1, end - 1);
const before = source.slice(0, start);
const mobile = before.lastIndexOf("@media (width <= 600px) {");
assert.ok(mobile >= 0, "Profile overrides require the mobile breakpoint");
const mediaDepth = [...before.slice(mobile)].reduce(
  (value, character) =>
    value + (character === "{" ? 1 : character === "}" ? -1 : 0),
  0,
);
assert.equal(
  mediaDepth,
  1,
  "Profile override must stay inside its mobile media query",
);
assert.doesNotMatch(
  profile,
  /user-navigation|user-card|user-preferences|display:\s*contents/,
);
assert.match(
  profile,
  /grid-template-columns:\s*var\(--isbf-profile-avatar-size\) minmax\(0, 1fr\)/,
);
assert.match(
  profile,
  /\.primary-textual\s*\{[^}]*min-width:\s*0;[^}]*width:\s*auto;/,
);
assert.match(profile, /\.controls\s*\{[^}]*grid-column:\s*1 \/ -1;/);
assert.match(profile, /button:not\(\.user-profile-toggle-btn\)/);
assert.match(profile, /\.secondary\s*\{[\s\S]*flex-wrap:\s*wrap;/);
assert.doesNotMatch(
  profile,
  /\.secondary[\s\S]*> div\s*\{[^}]*display:/,
  "Metadata row styles must preserve native hidden fields",
);
assert.match(profile, /white-space:\s*normal;/);
assert.match(profile, /overflow-wrap:\s*anywhere;/);
assert.match(profile, /min-height:\s*44px;/);
assert.doesNotMatch(
  profile,
  /color:|background(?:-color)?:|user-profile-image/,
  "Profile layout must preserve theme colors and existing banner rendering",
);

const number = (name) =>
  Number(profile.match(new RegExp(`${name}:\\s*(\\d+)px;`))?.[1]);
const avatar = number("--isbf-profile-avatar-size");
const gap = number("--isbf-profile-column-gap");
assert.equal(avatar, 96);
assert.equal(gap, 12);
for (const width of [390, 430]) {
  const available = width - 2 * 16;
  assert.ok(
    available - avatar - gap >= 200,
    `${width}px must retain space for wrapping profile text`,
  );
}
assert.ok(1024 > 600, "Desktop must remain outside the profile breakpoint");
process.stdout.write(
  "Mobile profile scope, responsive width, native visibility, and action constraints passed.\n",
);
