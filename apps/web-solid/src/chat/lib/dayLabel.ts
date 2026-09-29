const DAY = 86_400_000;

export function formatDayLabel(dayStart: number, now: number): string {
  const days = Math.round((dayStartOf(now) - dayStart) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const date = new Date(dayStart);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function formatTimeOfDay(sentAt: number): string {
  return new Date(sentAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatFullTimestamp(sentAt: number): string {
  return new Date(sentAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayStartOf(sentAt: number): number {
  const date = new Date(sentAt);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
