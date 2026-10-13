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
