# Sidebar More production release

## Scope

The user authorized updating the existing domain site, `isbf-one.com`, after
confirming that the separate development service should remain stopped.
This release adds the desktop More menu, native preferences/login navigation,
the existing feedback category feed, and the configurable recruitment modal.
Mobile receives no additional navigation entry.

## Source integration

This branch starts from the existing feature stack at `13e248c` and applies the
More feature from `dde6ef7`. The live production Theme 4 was exported before
changes. Its information pages, badges, topic-list layout, feed action spacing,
and notification layout were incorporated into the affected source files.
Unrelated theme fields and configured settings will not be replaced.

The feedback category is the existing public category with ID 2, `Site Feedback`.
The deployment adds the `gear` icon to the current icon list without replacing it.
No Core, plugin, permission, or database schema changes are included.

## Verification

- All nine existing `scripts/check-*.mjs` checks passed.
- Prettier checked the affected theme source files.
- Discourse stylelint configuration passed for shared SCSS.
- `git diff --check` passed.

The user requested no explicit compilation or page checks for this synchronization.
Interactive checks of menu positioning, keyboard navigation, feedback posting,
and real devices remain unverified. Static checks are not browser verification.
Saving the theme uses the framework's normal validation and resource processing.

## Rollback and deployment

The production container is `isbf_app`, database `discourse`, default Theme 4.
The rollback package is retained on the host at:

`/home/tangency/isbf-sidebar-more-production-20261005/rollback/theme-4.zip`

The original source fields, configured settings, and SVG icon list are saved with
that package. Its SHA-256 is
`a8abe40cdb57c746a48c928f02bdd8583787d89e35ea234e312434ad96b88827`.

Deployment checks the live field checksums against this snapshot inside a
transaction, imports only the ten affected source fields from the merged release
commit, and verifies that unrelated fields and configured settings are preserved.
The release record stores the actual merged GitHub commit and field checksums.
It does not start, stop, or restart either environment.
