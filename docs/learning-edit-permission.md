# Course resource editing permission

The developer settings page already exposes **管理学习资源**
(`academy_moderators_manage_resources`). The role registry maps it to
`academy_moderator_permissions.manage_resources`. This grant includes creating,
editing, deleting and recovering course resources. **编辑他人内容** and
**审核学习资源** are separate grants and do not authorize resource editing.

The course resource card, page action and share/edit dialog must all use the same
resource management capability. The native first-post `can_edit` response remains
required before hydrating the editor; saves continue through `PUT /posts/:id.json`
and the existing learning plugin Guardian and PostRevisor checks. An unavailable
backend capability or an inaccessible resource must continue to block editing.

The campus library retains its existing developer-only resource management rule.
Legacy attachments retain their existing supported operations; this change only
enables the existing link-resource editor for delegated course resource managers.

Regression checks live in `scripts/check-learning-ui.mjs` and
`scripts/check-library-ui.mjs`: resource managers can open, hydrate and save the
editor, unrelated grants cannot edit, and revocation during menu close, loading or
before save prevents the corresponding action. Existing load/save failure,
retry, destruction and cross-library cases remain covered.
