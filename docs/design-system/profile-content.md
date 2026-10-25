# Profile content and preferences

This candidate restyles the lower region of the existing profile. Its scope is
summary, activity, messages, invitations, badges, and all available preference
subroutes. Navigation retains its separate capsule styles and 3px landing motion.
The profile header, user cards, dialogs, routes, data, permission checks, native
fields, and save/error behavior remain owned by their existing implementations.

The reuse map is C15/D01-D05: top-aligned single-column settings, 44px controls,
8px field corners, 16px field spacing, semantic surfaces and borders, pill actions,
and two-column statistics/badge collections. Group boundaries use the existing
border and small radius locally. They do not establish a global card or form
variant. Summaries and public activity retain the existing A12 preview machinery;
private lists retain their native renderers and actions.

The form layout also follows the top-aligned label and persistent helper-text
pattern described in [Fluent 2 Field usage](https://fluent2.microsoft.design/components/web/react/core/field/usage/).
That reference supplies a layout pattern only. Colors, fonts, spacing and shapes
remain ISBF tokens, with no Fluent package or palette dependency.

The `isbf-profile-content` hook is attached only inside the admitted profile shell.
Styles target the lower wrapper, including native plugin preference fields.
Select-kit, FormKit, native inputs and checkboxes retain their semantics and event
handlers. No control is cloned, hidden, submitted, or replaced by a visual replica.
No new text, synthetic product statistics, or private-data preview is introduced.

This is a review candidate. Interactive acceptance, source hashes, validation,
deployment authorization and backups belong in the private task receipt. Apply
only this initializer, stylesheet and import to a fresh theme export; preserve
unrelated database-managed theme fields and later collaborator changes.

The final candidate passed the server's locked ESLint, Prettier and Stylelint.
Native-browser checks cover sixteen routes: dark at 320/390/839/1440px and light at
320/839px, for 96 layout scenarios. The checks found no page or primary-control
overflow, no undersized primary form controls, and no changes to distinct native
input/select schemas. At 320px the custom select menu stays within the content
viewport, Escape closes it, and keyboard focus remains visible. Native color-mode
saving was exercised and the synthetic user's original options were restored.

The fixture contains synthetic users and public posts. Private-message and
invitation lists are empty, so populated private rows were not visually exercised.
Physical devices and Safari were not tested. These checks do not establish user
acceptance or authorization to publish this candidate.
