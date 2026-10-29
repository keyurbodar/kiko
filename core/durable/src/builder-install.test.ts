import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { describe, expect, it } from "vitest"
import { installBuilder } from "./builder-install"
import { type Cloudflare, CloudflareError } from "./cloudflare"
import type { ReleaseManifest } from "./release"

const BUILDING: ReleaseManifest["builder"] = {
  main_module: "index.js",
  compatibility_date: "2026-09-01",
  compatibility_flags: [],
  durable_objects: [{ name: "BUILDER", class_name: "Builder" }],
  migrations: [{ tag: "v1", new_sqlite_classes: ["Builder"] }],
  modules: [{ name: "index.js", type: "application/javascript+module", sha256: "sha" }],
}

const release = (builder: ReleaseManifest["builder"]) => ({
  manifest: {
    version: "2.0.0",
    protocol: 3,
    main_module: "index.js",
    compatibility_date: "2026-09-01",
    compatibility_flags: [],
    migrations: [],
    modules: [],
    ...(builder ? { builder } : {}),
  } as ReleaseManifest,
  files: new Map([["builder/index.js", new TextEncoder().encode("export default {}")]]),
})

const cloudflare = (uploads: string[], puts: "succeed" | "refuse"): Cloudflare => ({
  call: ((path: string, init?: RequestInit) => {
    if (init?.method !== "PUT") return Effect.succeed([])
    uploads.push(path)
    return puts === "succeed"
      ? Effect.succeed({})
      : Effect.fail(new CloudflareError({ status: 403, codes: [10000], said: "denied", request: "PUT" }))
  }) as Cloudflare["call"],
})

const install = (builder: ReleaseManifest["builder"], puts: "succeed" | "refuse") => {
  const uploads: string[] = []
  const exit = Effect.runPromiseExit(installBuilder(cloudflare(uploads, puts), "acc", "kiko", release(builder)))
  return { uploads, exit }
}

describe("installBuilder", () => {
  it("returns nothing and uploads nothing when the release has no builder", async () => {
    const { uploads, exit } = install(undefined, "succeed")
    const done = await exit

    expect(Exit.isSuccess(done) && done.value).toBeNull()
    expect(uploads).toEqual([])
  })

  it("installs the builder and hands back its binding", async () => {
    const { uploads, exit } = install(BUILDING, "succeed")
    const done = await exit

    expect(uploads).toEqual(["/accounts/acc/workers/scripts/kiko-builder"])
    expect(Exit.isSuccess(done) && done.value).toEqual({
      type: "service",
      name: "BUILDER",
      service: "kiko-builder",
    })
  })

  it("fails when Cloudflare refuses the builder upload", async () => {
    const { uploads, exit } = install(BUILDING, "refuse")
    const done = await exit

    expect(uploads).toEqual(["/accounts/acc/workers/scripts/kiko-builder"])
    expect(Exit.isFailure(done)).toBe(true)
  })
})
