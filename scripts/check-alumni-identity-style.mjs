import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const req = createRequire(resolve(process.argv[2] || ".", "package.json"));
const write = process.argv.includes("--write");
const prettier = req("prettier");
const prettierConfig = req("@discourse/lint-configs/prettier");
const { ESLint } = req("eslint");
const { default: recommended } = await import(
  pathToFileURL(req.resolve("@discourse/lint-configs/eslint-theme"))
);
const { default: stylelint } = await import(
  pathToFileURL(req.resolve("stylelint"))
);
const files = [
  "javascripts/discourse/api-initializers/isbf-alumni-identity.gjs",
  ...[
    "isbf-alumni-label",
    "isbf-alumni-native-label",
    "isbf-alumni-search-labels",
    "isbf-v2-feed-card",
    "isbf-topic-metadata",
    "isbf-notification-entry",
    "isbf-alumni",
    "isbf-v2-account-menu",
  ].map((name) => `javascripts/discourse/components/${name}.gjs`),
  "javascripts/discourse/lib/alumni-identities.js",
  "javascripts/discourse/lib/alumni-label-targets.js",
  "javascripts/discourse/services/isbf-alumni-identity.js",
  "scripts/check-alumni-identity.mjs",
  "scripts/check-alumni-label-targets.mjs",
  "scripts/check-alumni-identity-style.mjs",
];
const styles = ["stylesheets/alumni-identity.scss"];
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: recommended,
  fix: write,
});
const lint = await eslint.lintFiles(files.map((path) => resolve(root, path)));
if (write) {
  await ESLint.outputFixes(lint);
}
const formatter = await eslint.loadFormatter("stylish");
const formattedLint = formatter.format(lint);
if (formattedLint) {
  process.stdout.write(formattedLint);
}
let failed = lint.some((result) => result.errorCount || result.warningCount);
for (const path of [...files, ...styles]) {
  const filepath = resolve(root, path);
  const source = readFileSync(filepath, "utf8");
  const formatted = await prettier.format(source, {
    ...prettierConfig,
    filepath,
  });
  if (write) {
    writeFileSync(filepath, formatted);
  } else if (formatted !== source) {
    process.stderr.write(`Prettier: ${path}\n`);
    failed = true;
  }
}
const css = await stylelint.lint({
  files: styles.map((path) => resolve(root, path)),
  config: { extends: [req.resolve("@discourse/lint-configs/stylelint")] },
  fix: write,
});
if (css.errored) {
  process.stderr.write(css.report);
  failed = true;
}
process.exitCode = failed ? 1 : 0;
if (!failed) {
  process.stdout.write("Alumni identity Prettier, ESLint and Stylelint OK\n");
}
