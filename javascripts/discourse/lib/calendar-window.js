export function calendarMonthAnchor(month, day) {
  const year = month.getFullYear();
  const index = month.getMonth();
  const lastDay = new Date(year, index + 1, 0).getDate();
  return new Date(year, index, Math.min(day, lastDay), 12);
}

export function calendarWindow(month, compact, expanded = false) {
  const anchor = calendarMonthAnchor(month, 1);
  const mondayOffset = (anchor.getDay() + 6) % 7;
  const from = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() - mondayOffset
  );
  const monthDays = new Date(
    anchor.getFullYear(),
    anchor.getMonth() + 1,
    0
  ).getDate();
  const dayCount =
    compact && !expanded && mondayOffset + monthDays <= 35 ? 35 : 42;
  const to = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate() + dayCount
  );
  return { from, to, dayCount };
}
