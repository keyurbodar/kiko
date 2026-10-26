import { load, owner, run } from "../state/runtime"

let sent = false

export async function syncTimeZone(): Promise<void> {
  if (sent) return
  sent = true
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!zone) return
  try {
    const stored = (await load(owner.queries.settings(undefined))).timezone
    if (stored === zone) return
    const result = await run(owner.commands.settingsUpdate, { patch: { timezone: zone } })
    if (result._tag === "Failure") sent = false
  } catch {
    sent = false
  }
}
