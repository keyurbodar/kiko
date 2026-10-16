import type { OAuthCredential, Provider } from "@earendil-works/pi-ai"
import type { Mode } from "../integrations/kernel/client"
import type { ComposioConnection } from "../integrations/composio/connect"
import { profileName } from "../integrations/kernel/connect"
import type { KernelWiring } from "./kernel-wiring"
import type { InitiativeEngine } from "../initiative/engine"
import { setSetting } from "../lib/settings"
import type { Reminders } from "./reminders"
import { LAST_SEEN } from "./keys"

// The bodies never reach a production bundle: dev-guard loads this module only in a dev build.

export async function devSeen(sql: SqlStorage, ago: number): Promise<void> {
  setSetting(sql, LAST_SEEN, String(Date.now() - ago))
}

export async function devSetting(sql: SqlStorage, key: "memory_policy", value: string): Promise<void> {
  if (key !== "memory_policy") throw new Error("not found")
  setSetting(sql, key, value)
}

export async function devUpdateConfig(sql: SqlStorage, config: Record<string, unknown>): Promise<void> {
  setSetting(sql, "dev_update", JSON.stringify(config))
  // A new config starts from its own grant, not the rotated one an earlier run stored.
  sql.exec("DELETE FROM settings WHERE key = 'cf_grant'")
}

export async function devComposioSession(composio: () => ComposioConnection): Promise<string | null> {
  return composio().sessionId()
}

export async function devCaptureQueue(sql: SqlStorage): Promise<number> {
  return sql.exec<{ n: number }>("SELECT count(*) AS n FROM capture_queue").one().n
}

export async function devDue(reminders: Reminders, id: string): Promise<void> {
  await reminders.makeDue(id)
}

export type DevBrowserOp = { action: "lease" | "touch" | "dead" | "age" | "reap" | "switch" | "state"; agentId?: string; mode?: Mode; ms?: number }

// DEVELOPMENT ONLY: `verify kernel` drives the lease and the reaper without waiting minutes.
export async function devBrowser(kernel: () => KernelWiring, userId: string, op: DevBrowserOp): Promise<Record<string, unknown>> {
  const k = kernel()
  if (op.action === "lease") {
    const { cdpUrl: _, ...rest } = await k.lease(op.agentId ?? "")
    return { ...rest, sessionId: k.sessionId() }
  }
  if (op.action === "touch") return { ok: k.touch(op.agentId ?? "") }
  if (op.action === "dead") {
    const gone = await k.browser.killForDev()
    if (gone) await k.dead(op.agentId ?? "", gone)
  }
  if (op.action === "age") k.age(op.ms ?? 0)
  if (op.action === "reap") await k.reap()
  if (["dead", "age", "reap"].includes(op.action)) return { sessionId: k.sessionId() }
  if (op.action === "switch") {
    const { cdpUrl: _, ...rest } = await k.browser.switchMode(op.mode === "headful" ? "headful" : "headless")
    return { ...rest, sessionId: k.sessionId() }
  }
  return { sessionId: k.sessionId(), status: k.status(), profile: await profileName(userId) }
}

export type DevInitiativeOp = { action: "age"; ms: number } | { action: "rhythm"; mode: "now" | "clear" } | { action: "pass" } | { action: "state" }

// Development only (section 26.8): a day of initiative in seconds.
export async function devInitiative(engine: () => InitiativeEngine, reminders: Reminders, op: DevInitiativeOp): Promise<unknown> {
  const e = engine()
  if (op.action === "rhythm") {
    e.devRhythm(op.mode)
    return { at: await e.arm() }
  }
  if (op.action === "pass") return e.pass()
  if (op.action === "state") return e.devState()
  e.devAge(op.ms)
  // A one-shot routine an agent set ages with the clock, and fires once the aging reaches it.
  await reminders.devAge(op.ms)
  return { at: await e.arm() }
}

// The sign-in test provider. Its flow shows a device code, then asks for it back.
export const FAKE_PROVIDER = "kiko-fake"
export const FAKE_CODE = "KIKO-0000"

export function fakeProvider(id: string): Provider | undefined {
  if (id !== FAKE_PROVIDER) return undefined
  return {
    id: FAKE_PROVIDER,
    name: "kiko fake",
    auth: {
      oauth: {
        name: "kiko fake sign-in",
        async login(interaction): Promise<OAuthCredential> {
          interaction.notify({
            type: "device_code",
            userCode: FAKE_CODE,
            verificationUri: "https://example.invalid/device",
            expiresInSeconds: 600,
          })
          const code = await interaction.prompt({ type: "manual_code", message: "type the code shown above" })
          if (code.trim() !== FAKE_CODE) throw new Error("that code is wrong")
          interaction.notify({ type: "progress", message: "code accepted" })
          return { type: "oauth", access: `fake-${crypto.randomUUID()}`, refresh: "fake", expires: Date.now() + 3_600_000 }
        },
        refresh: async (credential) => credential,
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
    },
    getModels: () => [],
    stream: noModels,
    streamSimple: noModels,
  }
}

function noModels(): never {
  throw new Error("the fake provider only signs in")
}
