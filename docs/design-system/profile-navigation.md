# Profile navigation

This theme enhancement styles the existing user-profile route links. It does not
replace Discourse's navigation items, overflow controls, routes, or permission checks.
The implementation is based on theme main `7192507` and the existing profile shell.

The main row uses a rounded neutral track, visible text, outline icons registered in
the theme's native SVG sprite, and a blue selected capsule. All secondary rows
(activity, messages, invitations, and preferences) use a connected rounded track
with a blue tinted selection and no checkmark. The track clips both ends to the
existing pill radius, including during horizontal scrolling.

Use the existing `--isbf-v2-*` surface, border, accent, contrast, focus, font, spacing,
and pill-radius tokens. These rules are scoped to `.isbf-profile-navigation`; they
do not create global navigation variants. Targets remain at least 44px high. Both
rows retain native single-line horizontal overflow and edge buttons.

The decorative capsule moves independent clip edges on a stationary drawing layer.
The cap radius follows the existing pill token and the unchanged thumb
height; the drawing layer is never scaled. Separate nested clips preserve the
secondary selection's existing one-pixel border and fill colors.

The motion reference is [RubberSegment](https://reactbits.dev/micro/rubber-segment?radius=24&squash=6&speed=1.2&size=lg)
and the supplied demonstration video. A 190ms dilation hands off at 150ms to a
300ms critically damped landing, followed by a 160ms relaxation. All phases are
divided by the reference speed of 1.2, giving approximately 508ms overall. The
trailing edge compresses by up to 3px, limited to preserve the end caps. The native
keyframes sample the easing curves without changing layout dimensions each frame.
Only the motion is adapted; the existing ISBF track, selection, and text colors
remain unchanged.
Rapid route changes start from the current visible shape. Scroll and resize align
it immediately; reduced motion disables animation. Native link, touch scrolling,
keyboard focus, and forced-colors behavior remain intact. Removing the enhancer
restores the original native markup and icons.

The visual reference is the profile-navigation proposal and the user's connected
secondary-track and elastic-motion revision. The reuse boundary is the existing C05
profile shell and its scoped tokens; the inner navigation is a separate design
surface. Keep final interactive acceptance and deployment state in the private task
receipt. Prototype review alone does not establish acceptance of the native version.

The deployed theme may include additional database-managed fields and later styles.
Apply only the added navigation fields, sprite upload, asset metadata entry, import,
and narrowed legacy profile border selector to a freshly exported theme. Never
replace its common stylesheet or other fields with this repository's full snapshot.
