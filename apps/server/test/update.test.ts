import { describe, expect, test } from "bun:test"
import { ClientToUser } from "@kiko/protocol/schema"
import { Schema } from "effect"
import { type CfGrant, runUpdate, type UpdateConfig, type UpdateDeps } from "../src/user/update"

const enc = new TextEncoder()
const BASE = "https://release.test/releases"

async function makeRelease(tamper?: "manifest" | "module" | "signature") {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
  const x = ((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey).x as string
  const code = enc.encode("export default {}")
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", code)).toString("hex")
  const manifest = enc.encode(
    JSON.stringify({
      version: "0.2.0",
      protocol: 1,
      main_module: "index.js",
      compatibility_date: "2026-09-01",
      compatibility_flags: ["nodejs_compat"],
      migrations: [{ tag: "v1", new_sqlite_classes: ["UserDO"] }, { tag: "v2", new_sqlite_classes: ["WorkDO"] }, { tag: "v3", deleted_classes: ["WorkDO"] }],
      modules: [{ name: "index.js", type: "application/javascript+module", sha256: hash }],
    }),
  )
  let sig = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, manifest)).toString("base64")
  if (tamper === "signature") sig = Buffer.from(new Uint8Array(64)).toString("base64")
  const served = tamper === "manifest" ? enc.encode(new TextDecoder().decode(manifest).replace("0.2.0", "0.2.1")) : manifest
  return {
    x,
    code,
    files: { "0.2.0/manifest.json": served, "0.2.0/manifest.sig": enc.encode(sig), "0.2.0/index.js": tamper === "module" ? enc.encode("evil") : code } as Record<string, Uint8Array>,
  }
}

type Call = { kind: string; url: string; method: string; body?: unknown; form?: FormData }

function setup(release: Awaited<ReturnType<typeof makeRelease>>, grant: CfGrant | null, opts: { scripts?: { id: string; migration_tag?: string }[]; refresh?: "ok" | "refused"; upload?: "ok" | "forbidden" } = {}) {
  const log: string[] = []
  const calls: Call[] = []
  const stages: { stage: string; error?: string }[] = []
  let saved: CfGrant | null = null
  const config: UpdateConfig = { releaseBase: BASE, publicKey: release.x, cfApi: "https://cf.test/client/v4", oauthUrl: "https://cf.test/oauth2/token" }
  const deps: UpdateDeps = {
    config,
    loadGrant: async () => grant,
    saveGrant: async (g) => {
      saved = g
      log.push("save")
    },
    report: (stage, error) => stages.push({ stage, ...(error ? { error } : {}) }),
    fetch: async (url, init = {}) => {
      const u = new URL(url)
      const method = init.method ?? "GET"
      if (u.host === "release.test") {
        log.push("release")
        const bytes = release.files[u.pathname.replace("/releases/", "")]
        return bytes ? new Response(bytes) : new Response("no", { status: 404 })
      }
      if (u.pathname === "/oauth2/token") {
        log.push("refresh")
        return opts.refresh === "refused" ? new Response("{}", { status: 400 }) : Response.json({ access_token: "new-at", refresh_token: "rotated-rt" })
      }
      const ok = (result: unknown) => Response.json({ success: true, result })
      if (method === "PUT") {
        log.push("put")
        if (opts.upload === "forbidden") return Response.json({ success: false, errors: [{ message: "no" }] }, { status: 403 })
        calls.push({ kind: "put", url, method, form: init.body as FormData })
        return ok({})
      }
      log.push("list")
      return ok(opts.scripts ?? [{ id: "kiko", migration_tag: "v1" }])
    },
  }
  return { deps, log, calls, stages, saved: () => saved }
}

const oauth: CfGrant = { kind: "oauth", accountId: "acc", scriptName: "kiko", clientId: "cid", refreshToken: "old-rt", accessToken: "old-at" }

async function metadataOf(form: FormData) {
  return JSON.parse(await (form.get("metadata") as unknown as File).text()) as { bindings: { type: string; name: string }[]; keep_bindings?: string[]; migrations: { old_tag?: string; new_tag: string; steps: { tag: string }[] } }
}

describe("update", () => {
  test("a good release walks the stages in order and uploads the verified bytes", async () => {
    const release = await makeRelease()
    const t = setup(release, oauth)
    await runUpdate(t.deps, "0.2.0")
    expect(t.stages.map((s) => s.stage)).toEqual(["checking", "authorizing", "uploading", "restarting"])
    const form = t.calls[0]?.form as FormData
    expect(new Uint8Array(await (form.get("index.js") as unknown as File).arrayBuffer())).toEqual(release.code)
  })

  test.each(["manifest", "module", "signature"] as const)("a tampered %s is refused before any grant is read or upload made", async (tamper) => {
    const t = setup(await makeRelease(tamper), oauth)
    await runUpdate(t.deps, "0.2.0")
    expect(t.stages.at(-1)).toMatchObject({ stage: "failed" })
    expect(t.stages.map((s) => s.stage)).not.toContain("authorizing")
    expect(t.log).not.toContain("refresh")
    expect(t.log).not.toContain("put")
  })

  test("a different version than the one asked for is refused", async () => {
    const t = setup(await makeRelease(), oauth)
    t.deps.fetch = ((inner) => async (url: string, init?: RequestInit) => inner(url.replace("/0.9.9/", "/0.2.0/"), init))(t.deps.fetch)
    await runUpdate(t.deps, "0.9.9")
    expect(t.stages.at(-1)).toMatchObject({ stage: "failed", error: expect.stringContaining("not the version") })
    expect(t.log).not.toContain("put")
  })

  test("the rotated refresh token is stored before the upload", async () => {
    const t = setup(await makeRelease(), oauth)
    await runUpdate(t.deps, "0.2.0")
    expect(t.log.indexOf("save")).toBeGreaterThan(t.log.indexOf("refresh"))
    expect(t.log.indexOf("save")).toBeLessThan(t.log.indexOf("put"))
    expect(t.saved()).toMatchObject({ refreshToken: "rotated-rt", accessToken: "new-at" })
  })

  test("a refused refresh asks the owner to reconnect and uploads nothing", async () => {
    const t = setup(await makeRelease(), oauth, { refresh: "refused" })
    await runUpdate(t.deps, "0.2.0")
    expect(t.stages.at(-1)?.error).toContain("Reconnect Cloudflare")
    expect(t.log).not.toContain("put")
  })

  test("no saved grant asks the owner to reconnect", async () => {
    const t = setup(await makeRelease(), null)
    await runUpdate(t.deps, "0.2.0")
    expect(t.stages.at(-1)).toMatchObject({ stage: "failed", error: expect.stringContaining("Reconnect Cloudflare") })
  })

  test("an upload Cloudflare refuses with 403 asks to reconnect", async () => {
    const t = setup(await makeRelease(), { kind: "token", accountId: "acc", scriptName: "kiko", token: "t" }, { upload: "forbidden" })
    await runUpdate(t.deps, "0.2.0")
    expect(t.stages.at(-1)?.error).toContain("Reconnect Cloudflare")
  })

  test("the upload keeps secrets, sends none, and picks migrations after the current tag", async () => {
    const t = setup(await makeRelease(), oauth, { scripts: [{ id: "other", migration_tag: "v3" }, { id: "kiko", migration_tag: "v1" }] })
    await runUpdate(t.deps, "0.2.0")
    const meta = await metadataOf(t.calls[0]?.form as FormData)
    expect(meta.keep_bindings).toEqual(["secret_text"])
    expect(meta.bindings.some((b) => b.type === "secret_text")).toBe(false)
    expect(JSON.stringify(meta)).not.toMatch(/SESSION_SECRET|CREDENTIALS_KEK/)
    expect(meta.migrations).toMatchObject({ old_tag: "v1", new_tag: "v3" })
    expect(meta.migrations.steps.map((s) => s.tag)).toEqual(["v2", "v3"])
  })

  test("a backend already at the latest tag sends no migration steps", async () => {
    const t = setup(await makeRelease(), oauth, { scripts: [{ id: "kiko", migration_tag: "v3" }] })
    await runUpdate(t.deps, "0.2.0")
    expect((await metadataOf(t.calls[0]?.form as FormData)).migrations.steps).toEqual([])
  })
})

describe("update frame at the socket edge", () => {
  const decode = Schema.decodeUnknownSync(ClientToUser)
  test("an exact version passes", () => {
    expect(decode({ t: "update.start", version: "0.2.0" })).toEqual({ t: "update.start", version: "0.2.0" })
  })
  test.each([{ t: "update.start" }, { t: "update.start", version: 2 }, { t: "update.start", version: "../x" }, { t: "update.start", version: "" }, { t: "update.start", version: "a".repeat(65) }])("%j is rejected", (frame) => {
    expect(() => decode(frame)).toThrow()
  })
})
