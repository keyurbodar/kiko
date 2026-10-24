import * as Schema from "effect/Schema"
import type { OAuthCredential, Provider } from "@earendil-works/pi-ai"
import type { Mode } from "../integrations/kernel/client"
import type { ComposioConnection } from "../integrations/composio/connect"
import { profileName } from "../integrations/kernel/connect"
import type { KernelWiring } from "./kernel-wiring"
import type { InitiativeEngine } from "../initiative/engine"
import { setSetting } from "../lib/settings"
import type { Reminders } from "./reminders"
import { LAST_SEEN } from "./keys"
import { applyOverlay, type CatalogOverlay } from "../models/catalog"
import { revisionOf, writeOverlay, writeState } from "../models/sync"

class FakeProviderError extends Schema.TaggedError<FakeProviderError>()("FakeProviderError", {
  message: Schema.String,
}) {}

export async function devSeen(sql: SqlStorage, ago: number): Promise<void> {
  setSetting(sql, LAST_SEEN, String(Date.now() - ago))
}

export async function devSetting(sql: SqlStorage, key: "memory_policy", value: string): Promise<void> {
  if (key !== "memory_policy") throw new FakeProviderError({ message: "not found" })
  setSetting(sql, key, value)
}

export async function devUpdateConfig(sql: SqlStorage, config: Record<string, unknown>): Promise<void> {
  setSetting(sql, "dev_update", JSON.stringify(config))
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

export type DevBrowserOp = {
  action: "lease" | "touch" | "dead" | "age" | "reap" | "switch" | "state"
  agentId?: string
  mode?: Mode
  ms?: number
}

export async function devBrowser(
  kernel: () => KernelWiring,
  userId: string,
  op: DevBrowserOp,
): Promise<Record<string, unknown>> {
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

export async function devPass(engine: () => InitiativeEngine): Promise<unknown> {
  return engine().pass()
}

const FAKE_PROVIDER = "kiko-fake"
const FAKE_CODE = "KIKO-0000"

type FakeRefresh = "fail" | "offline" | "ok"

let fakeRefresh: FakeRefresh = "ok"

export function setFakeRefresh(mode: FakeRefresh): void {
  fakeRefresh = mode
}

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
          if (code.trim() !== FAKE_CODE) throw new FakeProviderError({ message: "that code is wrong" })
          interaction.notify({ type: "progress", message: "code accepted" })
          return { type: "oauth", access: `fake-${crypto.randomUUID()}`, refresh: "fake", expires: Date.now() + 60_000 }
        },
        refresh: async (credential) => {
          if (fakeRefresh === "fail")
            throw new FakeProviderError({ message: "OAuth token request failed (400): invalid_grant" })
          if (fakeRefresh === "offline") throw new FakeProviderError({ message: "fetch failed" })
          return { ...credential, expires: Date.now() + 3_600_000 }
        },
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
    },
    getModels: () => [],
    stream: noModels,
    streamSimple: noModels,
  }
}

export async function devModelOverlay(sql: SqlStorage, overlay: CatalogOverlay): Promise<void> {
  const now = Date.now()
  const revision = await revisionOf(overlay)
  writeOverlay(sql, overlay)
  writeState(sql, { lastModified: now, checkedAt: now, revision })
  applyOverlay(overlay, revision)
}

function noModels(): never {
  throw new FakeProviderError({ message: "the fake provider only signs in" })
}
