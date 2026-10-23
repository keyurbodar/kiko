import * as Alchemy from "alchemy"
import { adopt } from "alchemy/AdoptPolicy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Effect from "effect/Effect"

const ZONE = "kiko.works"
const COMPATIBILITY = "2026-09-01"

export const FrontDoor = Cloudflare.Worker("FrontDoor", {
  name: "kiko-app",
  main: "../apps/server/src/front-door.ts",
  compatibility: { date: COMPATIBILITY, flags: ["legacy_module_registry"] },
  workersDev: false,
  observability: { enabled: false },
  assets: {
    directory: "../apps/web-solid/dist",
    notFoundHandling: "single-page-application",
    runWorkerFirst: ["/assets/*"],
  },
  domain: { name: "app.kiko.works", zoneName: ZONE },
})

export const Installer = Cloudflare.Worker("Installer", {
  name: "kiko-installer",
  main: "../apps/installer/src/index.ts",
  compatibility: { date: COMPATIBILITY, flags: ["nodejs_compat", "legacy_module_registry"] },
  workersDev: false,
  observability: {
    enabled: true,
    logs: { enabled: true, invocationLogs: true, persist: true, headSamplingRate: 1 },
    traces: { enabled: false, persist: true, headSamplingRate: 1 },
  },
  domain: { name: "api.kiko.works", zoneName: ZONE },
  env: { INSTALLER: Cloudflare.DurableObject("Installer") },
})

export default Alchemy.Stack(
  "Kiko",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const frontDoor = yield* FrontDoor
    const installer = yield* Installer
    return { frontDoorUrl: frontDoor.url, installerUrl: installer.url }
  }).pipe(adopt(true)),
)
