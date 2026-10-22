# Mobile calendar month view

At widths up to 600px, the calendar starts on the Monday of the week containing
the first of the visible month. It shows at least five weeks (35 dates), retaining
six weeks whenever the natural month needs them. October 2026 starts on
September 28 and normally ends on November 1; its optional sixth week is
November 2–8. November 2026 naturally needs six weeks. February 2027 retains
five rows even though the month itself fits in four. Wider layouts show 42 dates.

The compact grid expands to six weeks if any fetched personal or community
occurrence overlaps the sixth week. All-day, cross-week and official schedule
items use their existing occurrence rules. The agenda filter does not affect
this decision. Removing the last sixth-week occurrence collapses the grid only
when every applicable request succeeds. A failed source preserves the previous
month decision, or the natural baseline if none exists; successful data can
still expand the grid during a partial failure. Decisions belong to the month
and account, and account changes clear them and the fetched data.

Both layouts fetch the full 42-day range before deciding how many rows to show.
Personal entries retain the existing 24-hour padding on each side. If the
community response reaches its 200-event cap on mobile, a separate query covers
days 36–42. Results are merged by event ID and occurrence start time. This
reduces omissions caused by the base cap; it cannot guarantee completeness if
the supplemental week itself exceeds the API cap. Failure is reported and does
not prove an empty sixth week. Local calendar arithmetic preserves dates across
DST, while official event timezone conversion remains unchanged.

Month arrows and mobile swipes retain today's preferred day number, clamping
short months without replacing that number: January 31 → February 28 → March 31.
Selecting a gray date opens its natural month in every layout. Entry links also
open the entry's natural month. Today returns to the current natural month.
Changing viewport size reuses the same 42-day query. Existing markers, filters,
subscriptions and date button sizes are retained.

On mobile, swipe vertically within the date grid: up opens the next month and
down opens the previous month. A swipe needs at least 48px vertical travel and
more than 1.5 times its horizontal travel. The grid reserves vertical gestures;
scroll the surrounding page or agenda to scroll the page. Horizontal panning
and pinch zoom remain available through CSS touch-action. Multi-touch,
touchcancel, month changes and account changes cancel the gesture. Desktop
touch handlers do nothing. The generated click is suppressed for 500ms after a
swipe; keyboard activation and the next real touch remain available.

A local-midnight timer, browser focus and visibility changes refresh today while
preserving manual month browsing. Component destruction removes listeners and
timers and invalidates pending responses. Responses from an earlier month,
account or supplemental query cannot overwrite current data. Production account
switching reloads the document; the component also checks account ownership when
loading a month.

Run `node --experimental-vm-modules scripts/check-calendar-five-weeks.mjs` from
the theme directory. The existing command name is retained for compatibility.
The VM suite checks natural month ranges in Shanghai and New York, display and
fetch ranges, sixth-week decisions, source failures and retry, cap probes and
deduplication, filtering, navigation, entry links, TouchEvents, resize, midnight,
focus, stale responses, account changes and disposal. It loads the real official
occurrence helper. Existing calendar and subscription checks remain required.
These checks exercise JavaScript behavior without rendering a browser; desktop,
mobile, light/dark and real iPhone gesture/scroll behavior still need actual
page verification.
