# Staff role labels

This configuration changes Chinese page terminology: native admin becomes 开发者,
and native moderator becomes 管理员. Core permission flags, automatic-group names
and IDs remain unchanged. Account linking still requires native admin approval.

The JSON lists explicit original and replacement values. It includes native page,
group, settings, report and wizard text, plus the account-switch approval error.
Mail bodies, system-message content, user titles and user data are not rewritten.
Do not regenerate replacements from already translated values.

Run inside the existing Discourse container from /src:

    ISBF_ROLE_LABELS_CONFIG=/path/to/config/staff-role-labels.json bin/rails runner /path/to/scripts/staff-role-labels.rb

The default mode only validates translations and group identities. To apply, set
ISBF_ROLE_LABELS_MODE=apply and ISBF_ROLE_LABELS_BACKUP to a new absolute file
outside Git. The script creates that file with mode 0600 before changing settings.
It refuses to overwrite other existing custom translations and applies changes
in a transaction, checking group memberships and native privilege flags.

To restore the same snapshot, use ISBF_ROLE_LABELS_MODE=rollback with the same
configuration and backup path. Rollback refuses to overwrite later edits. Keep
the snapshot together with the Theme ID 4 export; neither belongs in Git.

Updating full names deliberately avoids automatic-group refresh, which can
rewrite internal group names and memberships.
