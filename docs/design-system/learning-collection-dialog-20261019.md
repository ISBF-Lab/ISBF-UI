# Learning collection dialog

The user approved this local combination on 2026-10-19 through three browser annotations: center the sharing dialog over a dimmed page, use explanatory copy followed by a blue form button as in the attached resume-submission reference, and place a management-only collection-link settings button immediately before My contributions.

Source baseline: ISBF-UI `bff5fc0e714e58a5a2679ac0549910dbef283b97`; the affected runtime fields matched the current database theme before implementation. The user's supplied resume image provides the invitation/button composition, without copying resume-specific content. Existing C15/D07 modal geometry and V2 surface/text/border/spacing/primary-button tokens remain local to this dialog. Native DModal owns the portal, backdrop, focus trap, Escape and close behavior; its backdrop now appears because the sharing dialog is no longer rendered inline. The collection dialog is centered at desktop and mobile widths with existing 600px maximum width and 16px viewport gutters.

The settings form uses FormKit URL validation and the existing `manage_resources` grant. The server enforces that grant independently of review permission and validates the single native site setting through a URL validator. HTTP and HTTPS links on other domains are accepted; no DNS lookup or WPS-domain restriction is applied. The default destination remains the user's existing WPS form. Site-setting changes retain native audit logging.

This approval does not extend to other dialogs, page regions, or global controls. Runtime verification and release evidence are recorded separately; rendering alone does not expand Approved scope.
