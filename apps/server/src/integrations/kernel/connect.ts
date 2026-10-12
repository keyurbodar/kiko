import type { BrowserState } from "@yuki/protocol"
import { sha256Hex } from "@yuki/durable/hash"
import { CredentialError } from "../../user/credentials"
import { KernelError } from "./client"
import { MAX_TABS } from "./lease"
import type { LeaseRow } from "./store"

/** A message that is safe to show. Kernel's errors never carry the key. */
export function kernelErrorText(e: unknown): string {
  if (e instanceof KernelError || e instanceof CredentialError) return e.message
  return `Kernel did not answer: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)
}

const AGENT_ID = /^[A-Za-z0-9_.:/-]{1,128}$/

/** The agent id an RPC caller names. It is only ever a key into the lease's tab map. */
export function checkAgentId(value: unknown): string {
  if (typeof value !== "string" || !AGENT_ID.test(value)) throw new KernelError("failed", "bad agent id")
  return value
}

export function checkTabs(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new KernelError("failed", "bad tabs")
  const entries = Object.entries(value)
  if (entries.length > MAX_TABS) throw new KernelError("failed", "too many tabs")
  for (const [id, url] of entries) {
    if (id.length === 0 || id.length > 64 || typeof url !== "string" || url.length > 2048) throw new KernelError("failed", "bad tabs")
  }
  return Object.fromEntries(entries) as Record<string, string>
}

/** How long Watch keeps the browser open, so the reaper does not delete it under the human's eyes. */
export const WATCH_MS = 10 * 60_000

/** The site a tab shows, as a hostname only: the client never sees a page URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "blank"
  } catch {
    return "blank"
  }
}

export function browserState(row: LeaseRow | undefined, switching: boolean, resolve: (agentId: string) => { slug: string; name: string }): BrowserState {
  if (!row || row.dead) return null
  const tabs = Object.entries(row.tabs).flatMap(([agentId, t]) => {
    const who = resolve(agentId)
    return Object.values(t).map((url) => ({ agent: who.name, slug: who.slug, host: hostOf(url) }))
  })
  return { mode: row.mode, tabs, takeover: row.takeover, switching, since: row.createdAt }
}

/** Where uploads land on the browser's VM, one directory per session. */
export const UPLOAD_DIR = "/tmp/kiko-uploads"
/** `yuki-` and 16 hex characters of the user's id hash. The name never comes from input. */
export async function profileName(userId: string): Promise<string> {
  return `yuki-${(await sha256Hex(userId)).slice(0, 16)}`
}
