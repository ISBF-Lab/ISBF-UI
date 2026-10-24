# Alumni map distribution

The existing directory layout, map size and responsive navigation stay in place. Country totals and China province fills use authenticated server aggregation of the complete public alumni directory, independently of list pagination. Province selection keeps its existing list filtering; selected provinces show city-center circles with counts and safe text tooltips.

The visible legend uses five exact bins: 0, 1–5, 6–10, 11–20 and 21+. All fills share theme accent/surface/muted variables in both color modes. Numeric labels and accessible names supplement color. Overlapping labels are prioritized by count and fit within the map viewport. Data refresh preserves the current pan and zoom.

`GET /isbf/alumni/distribution` supplies country, region and city aggregate rows. No names or private application data are part of these responses. Missing, malformed or failed results remain unknown instead of becoming zero. Each page instance retains at most 40 successful contexts for its current account, coalesces duplicate requests, discards old responses and clears state on account changes or destruction. Profile saves invalidate all distribution contexts.

The geography endpoint supplies only verified static city centers matching stable city IDs; it performs no runtime geocoding. Historical profiles without cities contribute to province/country totals. Missing verified coordinates suppress only the city marker, not its counts.

The confirmation preview uses illustrative people counts. No preview data is included in the theme or plugin. The feature branches target the existing theme release branch and the plugin main branch; release requires actual CI, native backup and source-hash checks. Browser/phone interaction validation is reported separately from static and HTTP/resource checks.

## Province labels and zoom

Automatic province labels require Leaflet zoom level 5 regardless of whether distribution counts have loaded. Zooming out closes them immediately. Country/city behavior, manual hover/focus tooltips and province selection remain available.

Label boxes use measured DOM text with the same Leaflet/theme class, font and padding, and polygon centers matching Leaflet tooltip placement. A hidden temporary measuring node avoids firing tooltip-open events and is always removed. Selected regions take priority, followed by higher counts, with at least eight CSS pixels between rendered boxes and map controls. Resize, zoom and pan recalculate the choices without changing map state.
