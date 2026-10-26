import type { ClaimResult, WebAppsResult } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import type { Apps, AppsOverview } from "./service"

const UNAVAILABLE: WebAppsResult = { ok: true, available: false, account: { state: "none" }, apps: [] }

const message = (e: unknown) => (e instanceof Error ? e.message : "Lakebed did not answer.")

const result = (overview: AppsOverview): WebAppsResult => ({
  ok: true,
  available: true,
  account: overview.account,
  apps: overview.apps.map((app) => ({ name: app.name, url: app.url, owned: app.claimed, expiresAt: app.expiresAt })),
})

function answer(apps: Apps | null, run: (apps: Apps) => Promise<AppsOverview>): Effect.Effect<WebAppsResult> {
  if (!apps) return Effect.succeed(UNAVAILABLE)
  return Effect.promise(() => run(apps).then(result, (e: unknown): WebAppsResult => ({ ok: false, error: message(e) })))
}

export const webAppsStatus = (apps: Apps | null) => answer(apps, (service) => service.overview())

export const webAppsConnect = (apps: Apps | null) =>
  answer(apps, async (service) => {
    await service.connect()
    return service.overview()
  })

export const webAppsDisconnect = (apps: Apps | null) =>
  answer(apps, (service) => {
    service.disconnect()
    return service.overview()
  })

export function webAppsClaim(apps: Apps | null, name: string): Effect.Effect<ClaimResult> {
  if (!apps) return Effect.succeed({ ok: false, error: "App building arrives with the next Kiko update." })
  return Effect.promise(() =>
    apps.claimLink(name).then(
      (link): ClaimResult => ({ ok: true, ...link }),
      (e: unknown): ClaimResult => ({ ok: false, error: message(e) }),
    ),
  )
}
