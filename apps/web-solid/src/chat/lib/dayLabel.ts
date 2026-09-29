const DAY = 86_400_000;

const dayLabel = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
});

const dayLabelWithYear = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const fullTimestamp = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDayLabel(dayStart: number, now: number): string {
  const days = Math.round((dayStartOf(now) - dayStart) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const date = new Date(dayStart);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return (sameYear ? dayLabel : dayLabelWithYear).format(date);
}

export function formatTimeOfDay(sentAt: number): string {
  return timeOfDay.format(new Date(sentAt));
}

export function formatFullTimestamp(sentAt: number): string {
  return fullTimestamp.format(new Date(sentAt));
}

function dayStartOf(sentAt: number): number {
  const date = new Date(sentAt);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
