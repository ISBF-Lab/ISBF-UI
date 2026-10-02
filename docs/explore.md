# Explore feed

The `/categories` route uses the shared Explore components when the ISBF-Explore
plugin is enabled. Its toolbar supports OR within categories or tags, AND between
these selections, and native activity/hot ordering. Categories use exact Core
filter paths, so descendant categories do not duplicate posts in parent groups.

Each group loads through the native TopicList filter model and its pagination.
The shared request queue limits in-flight filter/detail requests to two and
discards stale queued jobs. Groups load near the viewport and reset when filters
or the current account change.

Collapsed groups measure one candidate card at a time. Measurement cards are
hidden and inert, load only body content, and bypass view tracking. Actual card
heights, visible controls, resize and media changes determine the preview count;
the first post is always retained. Expanded groups use the same feed cards and
native load-more URL.

Logged-in preferences restore before topics load. Saves are debounced and
serialized, preserve newer pending selections, and offer a retry on failure.
Guests retain selections only while this page instance is open. Canonical tag
names come from the plugin's extension to the existing permission-checked tag
info serializer; translated names are kept for display.

Checks: `node --experimental-vm-modules scripts/check-explore-ui.mjs` covers query
semantics, concurrency, measured previews, stale jobs and serialized save/retry.
Glimmer, styles, native interactions and account restoration also require the
existing Discourse integration environment.
