import type { Alarms } from "@kiko/durable/alarm"
import { sha256Hex } from "@kiko/durable/hash"
import { deleteSetting, getSetting, setSetting } from "../lib/settings"

export const ANNOUNCE_WAKEUP = "announce"
export const ANNOUNCE_WINDOW_MS = 60_000

const PENDING = "announce_pending"
const SETTLED = "announced:"

type Pending = { since: number; changes: Record<string, { state: string | null; line: string }> }

export type Change = { kind: string; secret: string | null; added: string; removed: string; changed: string }

type AnnounceDeps = {
  sql: SqlStorage
  alarms: Alarms
  now: () => number
  /** Wakes Kiko in the Kiko chat. Throws when the room cannot be reached, so the alarm retries. */
  send: (id: string, body: string) => Promise<void>
}

/**
 * What the human changed in the system, told to Kiko once. A change is compared with the last state
 * that was announced, so saving the same key twice says nothing. Changes inside one window become one wake.
 */
export class Announcements {
  constructor(private readonly d: AnnounceDeps) {}

  async note(change: Change): Promise<void> {

    const state = change.secret === null ? null : await sha256Hex(change.secret)
    const settled = getSetting(this.d.sql, SETTLED + change.kind)
    const stored = this.#pending()
    const pending = stored ?? { since: this.d.now(), changes: {} }
    if (state === settled) delete pending.changes[change.kind]
    else pending.changes[change.kind] = { state, line: settled === null ? change.added : state === null ? change.removed : change.changed }
    if (!Object.keys(pending.changes).length) {
      deleteSetting(this.d.sql, PENDING)
      await this.d.alarms.clearWakeup(ANNOUNCE_WAKEUP)
      return
    }
    setSetting(this.d.sql, PENDING, JSON.stringify(pending))
    if (!stored) await this.d.alarms.setWakeup(ANNOUNCE_WAKEUP, pending.since + ANNOUNCE_WINDOW_MS)
  }

  async flush(): Promise<void> {
    const pending = this.#pending()
    if (!pending) return
    const entries = Object.entries(pending.changes).sort(([a], [b]) => a.localeCompare(b))
    const id = `system:${pending.since}:${(await sha256Hex(JSON.stringify(entries.map(([k, c]) => [k, c.state])))).slice(0, 16)}`
    // This wakes Kiko so its next run sees the new setup. It is not news for the human: telling them
    // their own change back produced a stray "your model provider is connected now" bubble.
    const body = `Your setup changed:\n${entries.map(([, c]) => `- ${c.line}`).join("\n")}\nNo reply is needed. The human made this change, so do not report it back. Reply only [skip].`
    await this.d.send(id, body)
    for (const [kind, c] of entries) {
      if (c.state === null) deleteSetting(this.d.sql, SETTLED + kind)
      else setSetting(this.d.sql, SETTLED + kind, c.state)
    }
    deleteSetting(this.d.sql, PENDING)
  }

  #pending(): Pending | null {
    const text = getSetting(this.d.sql, PENDING)
    return text ? (JSON.parse(text) as Pending) : null
  }
}

export const COMPOSIO_CHANGE: Omit<Change, "secret"> = {
  kind: "composio",
  added: "Added a Composio key. You can use the human's connected apps through Composio.",
  removed: "Removed the Composio key. You no longer have Composio apps.",
  changed: "Replaced the Composio key.",
}

export const KERNEL_CHANGE: Omit<Change, "secret"> = {
  kind: "kernel",
  added: "Added a Kernel key. You can browse the web in a real browser now.",
  removed: "Removed the Kernel key. You no longer have a browser.",
  changed: "Replaced the Kernel key.",
}

export const providerChange = (provider: string, secret: string | null): Change => ({
  kind: `provider:${provider}`,
  secret,
  added: `Connected the model provider ${provider}. Its models are available to you and your agents.`,
  removed: `Removed the model provider ${provider}. Its models are gone.`,
  changed: `Replaced the key for the model provider ${provider}.`,
})

export const updateChange = (version: string): Change => ({
  kind: "update",
  secret: version,
  added: `Kiko updated to version ${version}.`,
  removed: "",
  changed: `Kiko updated to version ${version}.`,
})
