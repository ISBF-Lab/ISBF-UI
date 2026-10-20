# Course resource actions menu

The user approved moving the four course header actions into an ellipsis menu at the upper right, using the supplied notification-menu screenshot as the visual reference. Menu items use centered text with transparent backgrounds. The title and trigger must stay on one row on small viewports; long titles truncate while retaining their full title attribute.

Scope: course resources only. Reuse the current course edit, collection form settings, contribution toggle and share callbacks, labels, disabled states and permission conditions. The independent library keeps its existing header action. No requests, permissions, backend or dialog frames change.

Engineering: native float-kit DMenu and UI kit DDropdownMenu/DButton provide placement, collision handling, outside click, Escape and keyboard focus. The popup remains a dropdown on mobile. Tokens reuse C06 notification menu space-2/space-3, border, radius-sm, text/surface, font-sm/weight-medium and the existing 44px touch target. Centered transparent rows and the one-line title are this user's local approved variation, not new global rules.

Source baseline: ISBF-UI a32e54309f1c0d56905b580b22211bc169a8fec0. Current production has the subsequent dialog-consistency stylesheet removals. Deployment applies only this task's patch onto the fresh live stylesheet, preserving those removals, shared dialog styles and unrelated theme fields. Pairing with a backend release is unnecessary.

Validation and the fixed candidate hashes are recorded in the task's private release receipts; no new broad regression suite is required for this presentation-only change. User authorization: “无需复测 直接上线”.
