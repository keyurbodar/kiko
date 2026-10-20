import { apiFetch } from "../lib/api"
let sent = false

export async function syncTimeZone(): Promise<void> {
  if (sent) return
  sent = true
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!zone) return
  try {
    const res = await apiFetch("/api/settings")
    const stored = res.ok ? ((await res.json()) as { timezone?: unknown }).timezone : undefined
    if (stored === zone) return
    await apiFetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone: zone }) })
  } catch {
    sent = false
  }
}
