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
assert.doesNotMatch(profile, /user-navigation|user-card|user-preferences/);
assert.match(
  profile,
  /grid-template-columns:\s*var\(--isbf-profile-avatar-size\) minmax\(0, 1fr\)/,
);
assert.match(profile, /\.primary-textual\s*\{[^}]*display:\s*contents;/);
assert.match(profile, /\.controls\s*\{[^}]*grid-column:\s*1 \/ -1;/);
assert.equal(
  [...profile.matchAll(/display:\s*contents;/g)].length,
  1,
  "Only the native generic text wrapper may be flattened",
);
assert.match(profile, /> \.user-profile-names\s*\{[^}]*grid-area:\s*1 \/ 2;/);
assert.match(
  profile,
  /> :not\(\.user-profile-names\)\s*\{[^}]*grid-column:\s*1 \/ -1;/,
);
assert.match(profile, /\.controls\s*\{[^}]*grid-row:\s*2;/);
assert.match(
  profile,
  /ul\s*\{[^}]*flex-direction:\s*column;[^}]*flex-wrap:\s*wrap;[^}]*align-items:\s*flex-end;/,
);
assert.match(profile, /button\s*\{[^}]*width:\s*auto;[^}]*font-size:\s*14px;/);
assert.match(profile, /\.d-icon\s*\{[^}]*font-size:\s*16px;/);
assert.match(profile, /> span:not\(:has\(> :not\(:empty\)\)\)/);
assert.match(profile, /> \.bio:not\(:has\(> :not\(:empty\)\)\)/);
assert.match(profile, /button:not\(\.user-profile-toggle-btn\)/);
assert.match(profile, /\.secondary\s*\{[\s\S]*flex-wrap:\s*wrap;/);
assert.doesNotMatch(
  profile,
  /\.secondary[\s\S]*> div\s*\{[^}]*display:/,
  "Metadata row styles must preserve native hidden fields",
);
assert.match(
  profile,
  /\.user-profile__location-and-website\s*\{[^}]*flex-direction:\s*column;[^}]*gap:\s*8px;/,
);
assert.match(
  profile,
  /\.user-profile-location,\s*\.user-profile-website\s*\{[^}]*width:\s*100%;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/,
);
assert.match(
  profile,
  /\.user-profile-website\s*\{[^}]*display:\s*flex;[\s\S]*> a,\s*> span\s*\{[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;/,
  "Both clickable websites and native non-link websites must truncate",
);
assert.match(profile, /\.d-icon\s*\{[^}]*flex-shrink:\s*0;/);
assert.match(
  profile,
  /\.bio\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/,
  "Long biographies must wrap and grow with the page",
);
assert.match(
  profile,
  /> div:has\(> \.profile-view-count, > \.email, > \.groups\)\s*\{\s*display:\s*none;/,
  "Hide only the requested native metadata rows, including their buttons",
);
assert.doesNotMatch(
  profile,
  /invited-by|trust-level|btn-delete-user|user-admin/,
  "Native management actions and other metadata must remain available",
);
assert.match(profile, /\.secondary\s*\{\s*display:\s*block;/);
assert.match(
  profile,
  /\.secondary\s*\{[^}]*margin:\s*0;[^}]*padding:\s*0;[^}]*border:\s*0;/,
);
assert.match(profile, /dl\s*\{[^}]*margin:\s*0;[^}]*padding:\s*0;/);
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
  "Mobile profile vertical details, ellipsis, expanding biography, metadata visibility, compact contacts, and responsive constraints passed.\n",
);
