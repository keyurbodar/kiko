export function dayStartOf(sentAt: number): number {
  if (!Number.isFinite(sentAt)) return 0;
  const d = new Date(sentAt);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
