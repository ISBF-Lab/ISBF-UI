export const TIMED_REMINDERS = [
  "none",
  "before_5m",
  "before_15m",
  "before_30m",
  "before_1h",
  "before_24h",
];
export const ALL_DAY_REMINDERS = ["none", "same_day_9am", "previous_day_9am"];

export function reminderModes(allDay) {
  return allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS;
}

export function compatibleReminder(mode, allDay) {
  return reminderModes(allDay).includes(mode) ? mode : "none";
}

export function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
}

export function reminderTime(
  mode,
  startsAt,
  allDay,
  timezone,
  official = false
) {
  if (mode === "none" || !startsAt) {
    return null;
  }
  if (!allDay) {
    const minutes = {
      before_5m: 5,
      before_15m: 15,
      before_30m: 30,
      before_1h: 60,
      before_24h: 1440,
    }[mode];
    return minutes ? new Date(startsAt).getTime() - minutes * 60000 : null;
  }
  let day = startsAt.slice(0, 10);
  if (official) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(new Date(startsAt))
        .map(({ type, value }) => [type, value])
    );
    day = `${parts.year}-${parts.month}-${parts.day}`;
  }
  const wall =
    new Date(`${day}T09:00:00Z`).getTime() -
    (mode === "previous_day_9am" ? 86400000 : 0);
  // Resolve wall-clock 09:00 in the entry timezone, including DST offsets.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .map(({ type, value }) => [type, value])
    );
    const formatted = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second
    );
    instant += wall - formatted;
  }
  return instant;
}

export function personalStartsAt(data) {
  return data.allDay
    ? `${data.startDate}T00:00:00.000Z`
    : `${data.startDate}T${data.startTime}`;
}
