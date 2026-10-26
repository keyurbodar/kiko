import { describe, expect, it } from "vitest"
import { sha256Hex } from "./hash"
import type { ReleaseMigration } from "./release"
import { loadVerifiedRelease } from "./release-load"

const BASE = "https://releases.test"

async function publish(migrations: ReleaseMigration[], builderCode?: { signed: string; served: string }) {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
  const publicKey = ((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey).x as string
  const module = new TextEncoder().encode("export default {}")
  const builder = builderCode && {
    main_module: "index.js",
    compatibility_date: "2026-09-01",
    compatibility_flags: [],
    durable_objects: [{ name: "BUILDER", class_name: "Builder" }],
    migrations: [{ tag: "v1", new_sqlite_classes: ["Builder"] }],
    modules: [
      {
        name: "index.js",
        type: "application/javascript+module",
        sha256: await sha256Hex(new TextEncoder().encode(builderCode.signed)),
      },
    ],
  }
  const manifest = new TextEncoder().encode(
    JSON.stringify({
      version: "2.0.0",
      protocol: 3,
      main_module: "index.js",
      compatibility_date: "2026-09-01",
      compatibility_flags: [],
      migrations,
      modules: [{ name: "index.js", type: "application/javascript+module", sha256: await sha256Hex(module) }],
      ...(builder ? { builder } : {}),
    }),
  )
  const signature = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, manifest))
  const files: Record<string, Uint8Array | string> = {
    "/latest-owner.json": JSON.stringify({ version: "2.0.0" }),
    "/2.0.0/manifest.json": manifest,
    "/2.0.0/manifest.sig": signature.toString("base64"),
    "/2.0.0/index.js": module,
    ...(builderCode ? { "/2.0.0/builder/index.js": builderCode.served } : {}),
  }
  const fetched: string[] = []
  const fetch = async (url: string) => {
    const path = new URL(url).pathname
    fetched.push(path)
    const file = files[path]
    return file === undefined ? new Response("missing", { status: 404 }) : new Response(file)
  }
  return { publicKey, fetch, fetched }
}

describe("loadVerifiedRelease", () => {
  it("loads the latest owner release and every module it signs", async () => {
    const release = await publish([{ tag: "v5", new_sqlite_classes: ["OwnerDO"] }])
    const loaded = await loadVerifiedRelease({ baseUrl: BASE, publicKey: release.publicKey }, release.fetch)
    expect(loaded.manifest.version).toBe("2.0.0")
    expect([...loaded.files.keys()]).toEqual(["index.js"])
    expect(release.fetched[0]).toBe("/latest-owner.json")
  })

  it("refuses a signed release whose migrations delete a class, before fetching its code", async () => {
    const release = await publish([
      { tag: "v5", new_sqlite_classes: ["OwnerDO"] },
      { tag: "v6", deleted_classes: ["OwnerDO"] },
    ])
    await expect(
      loadVerifiedRelease({ baseUrl: BASE, publicKey: release.publicKey, version: "2.0.0" }, release.fetch),
    ).rejects.toMatchObject({ _tag: "ReleaseRefused", code: "release_untrusted" })
    expect(release.fetched).not.toContain("/2.0.0/index.js")
  })

  it("loads the signed builder modules under builder/", async () => {
    const release = await publish([{ tag: "v5", new_sqlite_classes: ["OwnerDO"] }], {
      signed: "export class Builder {}",
      served: "export class Builder {}",
    })
    const loaded = await loadVerifiedRelease({ baseUrl: BASE, publicKey: release.publicKey }, release.fetch)
    expect([...loaded.files.keys()]).toEqual(["index.js", "builder/index.js"])
    expect(loaded.manifest.builder?.durable_objects).toEqual([{ name: "BUILDER", class_name: "Builder" }])
  })

  it("refuses a builder module that does not match the signed manifest", async () => {
    const release = await publish([{ tag: "v5", new_sqlite_classes: ["OwnerDO"] }], {
      signed: "export class Builder {}",
      served: "export class Builder { evil() {} }",
    })
    await expect(
      loadVerifiedRelease({ baseUrl: BASE, publicKey: release.publicKey }, release.fetch),
    ).rejects.toMatchObject({ _tag: "ReleaseRefused", code: "release_untrusted" })
  })
})
