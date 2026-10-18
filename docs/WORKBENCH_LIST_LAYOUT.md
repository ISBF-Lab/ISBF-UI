# Workbench marketplace and teamup list layout

The active database-backed theme imports `workbench-topics` from its common
stylesheet. `stylesheets/workbench-topics.scss` preserves that existing shared
page stylesheet and changes only two width references: the list container and
the fixed publish button use `--isbf-v2-feed-width` instead of
`--isbf-v2-feature-width`.

Marketplace and teamup display a single list in the feed column. Using the wider
feature column made the page border, teamup actions, and publish button extend
past the underlying content column. The existing mobile override, spacing,
colors, typography, checkbox styling, components, permissions, and handlers are
preserved. No new visual tokens are introduced.

Deploy this change as a delta to the existing `extra_scss/workbench-topics`
theme field. Read the current theme and verify its original field digest before
the update; preserve all other fields and settings. The historical common
stylesheet in this repository is not a complete copy of the live theme and must
not replace it or be uploaded wholesale.

Validation covers native Core Prettier/Stylelint in an isolated, capped tool
container, standalone Sass compilation using the running image's dependency
versions, and 24 offline layout scenes using actual rendered DOM and stylesheet
assets. The scene widths are 1440, 800, 601, 600, 390, and 320 pixels, for both
lists and both palettes. These checks validate geometry; live page loading is
verified separately after the field update.

The production update completed on 2026-10-14 at 00:26:10 Asia/Taipei.
Only field 375 (`extra_scss/workbench-topics`) changed; the other 175 theme
fields, theme settings, JavaScript cache, relations, translations, and palettes
were preserved. The complete Core source and 64 plugin trees matched the
recorded baseline after deployment. Native theme compilation and eight live
desktop/mobile, light/dark scenes passed, with both lists fully loaded. One
initial teamup query failed and recovered through its existing retry action
with HTTP 200; no query logic was changed.

The deployed stylesheet SHA-256 is
`adbba36ff81f32992fecb88c5bbe68c608abd57663ebd3737bac42f9a27c3020`.
The fresh original-field backup and guarded rollback record are in
`/home/luo/backup/20261014-002437+0800-workbench-list-ui/`.
Theme source checks passed in GitHub Actions run `38429224401`; the source
remains under review in pull request #81 and has not been merged.
