import * as Schema from "effect/Schema"
import { type Keyring, open, seal } from "@kiko/durable/crypto"
import { loadVerifiedRelease, ReleaseRefused } from "@kiko/durable/release-load"
import { buildMetadata, destructiveMigration, selectMigrations, uploadBody } from "@kiko/durable/release-plan"
import type { UpdateStage } from "@kiko/protocol"

type CfGrant = {
  kind: "oauth" | "token"
  accountId: string
  scriptName: string
  clientId?: string
  accessToken?: string
  refreshToken?: string
  token?: string
}

export type UpdateConfig = { releaseBase: string; publicKey: string; cfApi: string; oauthUrl: string }

type UpdateDeps = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  config: UpdateConfig
  loadGrant: () => Promise<CfGrant | null>
  saveGrant: (grant: CfGrant) => Promise<void>
  report: (stage: UpdateStage, error?: string) => void
}

class UpdateFailure extends Schema.TaggedError<UpdateFailure>()("UpdateFailure", {
  message: Schema.String,
}) {}

const RECONNECT = "Reconnect Cloudflare, then try again."

export function parseGrant(text: string | null | undefined): CfGrant | null {
  if (!text) return null
  try {
    const g = JSON.parse(text) as Partial<CfGrant>
    const text1 = (v: unknown): v is string => typeof v === "string" && v.length > 0
    if (!text1(g.accountId) || !text1(g.scriptName)) return null
    if (g.kind === "token" && text1(g.token)) return g as CfGrant
    if (g.kind === "oauth" && text1(g.clientId) && text1(g.refreshToken)) return g as CfGrant
    return null
  } catch {
    return null
  }
}

async function accessToken(deps: UpdateDeps, grant: CfGrant): Promise<string> {
  if (grant.kind === "token") return grant.token as string
  let res: Response
  try {
    res = await deps.fetch(deps.config.oauthUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: grant.refreshToken as string,
        client_id: grant.clientId as string,
      }),
    })
  } catch {
    throw new UpdateFailure({ message: "Cloudflare could not be reached. Try again." })
  }
  const body = (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string } | null
  if (!res.ok || !body?.access_token)
    throw new UpdateFailure({ message: `Cloudflare refused the saved sign-in. ${RECONNECT}` })
  await deps.saveGrant({
    ...grant,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? grant.refreshToken,
  })
  return body.access_token
}

async function cf<T>(deps: UpdateDeps, token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)
  let res: Response
  try {
    res = await deps.fetch(`${deps.config.cfApi}${path}`, { ...init, headers })
  } catch {
    throw new UpdateFailure({ message: "Cloudflare could not be reached. Try again." })
  }
  const body = (await res.json().catch(() => null)) as {
    success?: boolean
    result?: T
    errors?: { message?: string }[]
  } | null
  if (res.status === 401 || res.status === 403)
    throw new UpdateFailure({ message: `Cloudflare refused the saved sign-in. ${RECONNECT}` })
  if (!res.ok || !body?.success)
    throw new UpdateFailure({ message: body?.errors?.[0]?.message ?? `Cloudflare answered ${res.status}.` })
  return body.result as T
}

export async function runUpdate(deps: UpdateDeps, version: string): Promise<void> {
  try {
    deps.report("checking")
    const { manifest, files } = await loadVerifiedRelease(
      { baseUrl: deps.config.releaseBase, publicKey: deps.config.publicKey, version },
      (url) => deps.fetch(url),
    )

    deps.report("authorizing")
    const grant = await deps.loadGrant()
    if (!grant) throw new UpdateFailure({ message: `Kiko has no Cloudflare sign-in saved. ${RECONNECT}` })
    const token = await accessToken(deps, grant)

    deps.report("uploading")
    const scripts = await cf<{ id: string; migration_tag?: string }[]>(
      deps,
      token,
      `/accounts/${grant.accountId}/workers/scripts`,
    )
    const own = scripts.find((s) => s.id === grant.scriptName)
    if (!own) throw new UpdateFailure({ message: "This backend was not found in your Cloudflare account." })
    let migrations: ReturnType<typeof selectMigrations>
    try {
      migrations = selectMigrations(manifest.migrations, own.migration_tag ?? null)
    } catch (e) {
      throw new UpdateFailure({ message: e instanceof Error ? e.message : "The release does not fit this backend." })
    }
    if (destructiveMigration(migrations))
      throw new UpdateFailure({
        message:
          "This release resets the backend's stored data. Export your data, then reconnect Cloudflare in the installer to review and confirm the reset.",
      })
    const settings = await cf<{ bindings?: { name: string; type: string }[] }>(
      deps,
      token,
      `/accounts/${grant.accountId}/workers/scripts/${grant.scriptName}/settings`,
    )
    const inheritedR2 =
      settings.bindings?.filter((binding) => binding.type === "r2_bucket").map((binding) => binding.name) ?? []
    await cf(deps, token, `/accounts/${grant.accountId}/workers/scripts/${grant.scriptName}`, {
      method: "PUT",
      body: uploadBody(manifest, files, buildMetadata(manifest, migrations, null, "inherit", inheritedR2)),
    })

    deps.report("restarting")
  } catch (e) {
    const message =
      e instanceof UpdateFailure || e instanceof ReleaseRefused ? e.message : "The update failed. Try again."
    deps.report("failed", message)
  }
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
const AAD = "cf-grant"

export async function sealGrant(keyring: Keyring, userId: string, grant: CfGrant): Promise<string> {
  const sealed = await seal(keyring, userId, AAD, JSON.stringify(grant))
  return JSON.stringify({ k: sealed.kekVersion, iv: b64(sealed.iv), ct: b64(sealed.ciphertext) })
}

export async function openGrant(keyring: Keyring, userId: string, stored: string): Promise<CfGrant | null> {
  try {
    const row = JSON.parse(stored) as { k: number; iv: string; ct: string }
    return parseGrant(
      await open(keyring, userId, AAD, { kekVersion: row.k, iv: unb64(row.iv), ciphertext: unb64(row.ct) }),
    )
  } catch {
    return null
  }
}
