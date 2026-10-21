# Alumni city and biography

Profile editing adds optional dependent city selection for China and optional free-text city elsewhere (80 characters). Province and country changes clear both city fields. Biography is optional plain text, limited to 500 Unicode characters on the server; client maxlength is an additional browser constraint.

The existing country/province geography and map remain unchanged. Authenticated site metadata carries the separately bundled city catalog; the public registration catalog exposes the same selections. Mainland data is pinned to modood commit c49d495b40ac73eb1a66f6eeae5f8fd10696f035; attribution, license and explicit TW/HK/MO supplements live beside cities.json.

Directory cards show country, province and resolved city, suppressing adjacent identical labels. Plain biography preserves line breaks below industry. Existing empty fields continue to return empty strings. Registration profile import does not use the legal name or enable public visibility.

Verification: check-alumni-ui.mjs covers city resets, optional blank fields, geographic labels and biography template constraints alongside existing directory races/pagination. New plugin request specs cover persistence, province/city mismatch, bio length, overseas fields and registration import. Browser, role and plugin integration verification must be reported separately by the release owner.
