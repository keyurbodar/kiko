export function durationLabel(ms: number): string {
  if (ms < 1_000) return "<1s"
  if (ms < 10_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`
  const total = Math.floor(ms / 1_000)
  const h = Math.floor(total / 3_600)
  const m = Math.floor((total % 3_600) / 60)
  const s = total % 60
  const parts = [h ? `${h}h` : "", m ? `${m}m` : "", s ? `${s}s` : ""].filter(Boolean)
  return parts.join(" ")
}

export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000))
  if (total < 60) return `${total}s`
  const h = Math.floor(total / 3_600)
  const m = Math.floor((total % 3_600) / 60)
  return h ? `${h}h ${m}m` : `${m}m ${total % 60}s`
}

export const fullTimeLabel = (at: number): string =>
  new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" })

export const workLabel = (ms: number): string => elapsedLabel(ms)
