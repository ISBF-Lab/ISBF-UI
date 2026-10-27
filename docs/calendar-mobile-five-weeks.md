# Mobile calendar window

At widths up to 600px the calendar renders 35 consecutive dates, Monday first.
Opening the page and choosing Today center today's week in row three. For
2026-10-20 the inclusive window is 2026-10-05 through 2026-11-08. Wider layouts
retain the existing 42-cell month view.

Month arrows keep the preferred day number. A short month clamps the displayed
anchor without replacing the preferred number, so January 31 → February 28 →
March 31. A date tap changes the agenda without moving the compact window,
including adjacent-month dates. Entry links can center their target date;
returning to Today clears that temporary anchor.

The grid and API requests use the same half-open range from `calendar-window`.
Date arithmetic uses local calendar days across DST; the personal entries API
retains its existing 24-hour padding. Official event timezone conversion remains
unchanged. Existing circle markers, filters, subscriptions and date button sizes
are reused without stylesheet changes.

Media-query changes reload the appropriate range and keep the selected date
visible. A local-midnight timer, browser focus and visibility changes update the
current-date view; manual browsing is retained. Component destruction removes
listeners and timers and invalidates pending responses.

Run `node --experimental-vm-modules scripts/check-calendar-five-weeks.mjs` for
window, navigation, query, lifecycle and race regressions. The existing calendar
and subscription checks remain required. Browser checks cover desktop and mobile
viewport sizes; they do not establish iPhone hardware behavior.
