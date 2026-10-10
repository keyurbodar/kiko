let sent = false

/** Tells the server the browser's time zone, once per session, when it differs from the stored one. Never blocks anything. */
export async function syncTimeZone(): Promise<void> {
  if (sent) return
  sent = true
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!zone) return
  try {
    const res = await fetch("/api/settings")
    const stored = res.ok ? ((await res.json()) as { timezone?: unknown }).timezone : undefined
    if (stored === zone) return
    await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone: zone }) })
  } catch {
    sent = false
  }
}
