# Course resource editing permission

The developer settings page already exposes **管理学习资源**
(`academy_moderators_manage_resources`). The role registry maps it to
`academy_moderator_permissions.manage_resources`. This grant includes creating,
editing, deleting and recovering course resources. **编辑他人内容** and
**审核学习资源** are separate grants and do not authorize resource editing.

The course resource card, page action, share/edit dialog and directory editor use
the same resource management capability. The learning resource response includes
the native first-post `can_edit` decision. The management dialog saves through
`PUT /isbf/learning/resources/:id`; the plugin still enforces Guardian and uses
PostRevisor without changing the original author. An unavailable backend
capability or an inaccessible resource continues to block editing.

The campus library retains its existing developer-only resource management rule
and shared link-resource editor. Course resource managers can also edit published
legacy resource metadata while preserving private attachments. Course names and
parent category labels use the same grant, keeping stable directory IDs.

Regression checks live in `scripts/check-learning-ui.mjs` and
`scripts/check-library-ui.mjs`: resource managers can open, hydrate and save the
editor, unrelated grants cannot edit, and revocation during menu close, loading or
before save prevents the corresponding action. Existing load/save failure,
retry, destruction and cross-library cases remain covered. The contribution script
and native rendering tests additionally cover the WPS-only member entry,
student-number selection, management forms and directory updates.
