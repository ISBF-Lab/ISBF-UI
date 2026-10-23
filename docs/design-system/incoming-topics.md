# Incoming topics notice

Approved scope: the user's 2026-10-23 request to keep the existing desktop notice
design on both desktop and mobile, anchored to the current viewport.

The native new or updated topics notice stays in the upper portion of the current
viewport while the reader scrolls. It follows the existing feed column coordinates,
including the mobile and compact-sidebar layouts, instead of the document's top.

Desktop and mobile use the existing desktop notice's native alert colors, compact
font size, padding and rounded corners. The surrounding fixed positioning area lets
pointer events pass through; the notice itself keeps its native click, keyboard,
loading and topic-count behavior. Existing chronological insertion is unchanged.

This applies only to populated native topic lists under the Campus Feed shell.
Empty lists, topic pages, admin screens, other themes and dialogs keep their current
behavior. The notice sits below the existing fixed headers and menus. Its vertical
position accounts for the safe area and viewport height.

Design reference: the existing desktop `.show-more.has-topics` and `.alert` rules in
Discourse `app/assets/stylesheets/common/base/_topic-list.scss`, within the approved
Campus Feed list surface (A02). The user's 2026-10-23 request approves applying that
desktop design on mobile and keeping the notice visible in the current viewport.
Browser comment outlines and numbered markers in the supplied screenshot are review
annotations and are not part of the notice design.

The reference is the deployed Campus Feed theme (database theme 4, inspected on
2026-10-23) and the native topic-list stylesheet from Core
`5a56f19ded90fe7f041222e2ad4bcdca63b9eb5a`. Existing feed positioning variables,
spacing, font and alert radius tokens are reused within this list surface only.

For release, add this stylesheet and append only its import to the current database
theme's common SCSS. Preserve all existing theme fields, settings and later edits;
the repository checkout is not a complete replacement for the live database theme.
