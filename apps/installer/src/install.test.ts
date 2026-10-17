import { describe, expect, test } from "bun:test"
import { type InstallEnv, runInstall } from "./install"

const enc = new TextEncoder()
const MANIFEST_MODULE = "index.js"

async function makeRelease(tamper?: "manifest" | "module") {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
  const x = ((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey).x as string
  const code = enc.encode("export default {}")
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", code)).toString("hex")
  const manifest = enc.encode(
    JSON.stringify({
      version: "0.1.0",
      protocol: 1,
      main_module: MANIFEST_MODULE,
      compatibility_date: "2026-09-01",
      compatibility_flags: ["nodejs_compat"],
      migrations: [{ tag: "v1", new_sqlite_classes: ["UserDO"] }, { tag: "v2", deleted_classes: ["WorkDO"] }],
      modules: [{ name: MANIFEST_MODULE, type: "application/javascript+module", sha256: hash }],
    }),
  )
  const sig = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, manifest)).toString("base64")
  const served = tamper === "manifest" ? enc.encode(new TextDecoder().decode(manifest).replace("0.1.0", "0.1.1")) : manifest
  return { x, files: { "latest.json": enc.encode('{"version":"0.1.0"}'), "0.1.0/manifest.json": served, "0.1.0/manifest.sig": enc.encode(sig), "0.1.0/index.js": tamper === "module" ? enc.encode("evil") : code } }
}

type Call = { url: string; method: string; body?: unknown }

function fakeCloudflare(opts: { release: Awaited<ReturnType<typeof makeRelease>>; scripts: { id: string; migration_tag?: string }[]; r2?: "ok" | "exists" | "disabled" }) {
  const calls: Call[] = []
  const ok = (result: unknown) => Response.json({ success: true, result })
  const fail = (code: number, message: string) => Response.json({ success: false, errors: [{ code, message }] }, { status: 400 })
  const fetcher = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? "GET"
    let body: unknown = init.body
    if (body instanceof FormData) {
      const meta = body.get("metadata") as unknown as File
      body = JSON.parse(await meta.text())
    } else if (typeof body === "string" && body.startsWith("{")) body = JSON.parse(body)
    calls.push({ url: input, method, body })
    const url = new URL(input)
    if (url.host === "dash.cloudflare.com") return Response.json({ access_token: "at", refresh_token: "rt" })
    if (url.host === "release.test") {
      const bytes = (opts.release.files as Record<string, Uint8Array>)[url.pathname.slice(1)]
      return bytes ? new Response(bytes) : new Response("no", { status: 404 })
    }
    if (url.host.endsWith(".workers.dev")) return url.host.startsWith("kiko.") ? Response.json({ version: "0.1.0" }) : new Response("no", { status: 404 })
    const path = url.pathname.replace("/client/v4", "")
    if (path === "/accounts") return ok([{ id: "acc1" }])
    if (path.endsWith("/workers/subdomain")) return ok({ subdomain: "me" })
    if (path.endsWith("/r2/buckets")) {
      if (opts.r2 === "disabled") return fail(10042, "Please enable R2 through the Cloudflare Dashboard.")
      return opts.r2 === "exists" ? fail(10004, "The bucket you tried to create already exists") : ok({})
    }
    if (path.endsWith("/workers/scripts") && method === "GET") return ok(opts.scripts)
    return ok({})
  }
  return { calls, fetcher }
}

function env(release: { x: string }): InstallEnv {
  return { CF_OAUTH_CLIENT_ID: "cid", CLERK_JWT_KEY: "PEM", FRONT_DOOR_ORIGIN: "https://app.kiko.codes", RELEASE_BASE_URL: "https://release.test", RELEASE_PUBLIC_KEY: release.x }
}

async function install(cfg: Parameters<typeof fakeCloudflare>[0], grant: Parameters<typeof runInstall>[2]["grant"] = { kind: "token", token: "tok" }) {
  const { calls, fetcher } = fakeCloudflare(cfg)
  const metadata: unknown[] = []
  let n = 0
  const result = await runInstall(env(cfg.release), { fetch: fetcher, randomSecret: () => `rand${n++}`, sleep: async () => {}, setMetadata: async (sub, m) => void metadata.push([sub, m]) }, { sub: "user_1", grant })
  const upload = calls.find((c) => c.method === "PUT" && c.url.endsWith("/workers/scripts/kiko")) as Call
  return { calls, upload, result, metadata }
}

const secretNames = (upload: Call) => ((upload.body as { bindings: { type: string; name: string }[] }).bindings).filter((b) => b.type === "secret_text").map((b) => b.name)

describe("runInstall", () => {
  test("first install sets the six secrets and the full migration list", async () => {
    const release = await makeRelease()
    const { upload, result, metadata, calls } = await install({ release, scripts: [] })
    expect(secretNames(upload).sort()).toEqual(["CF_GRANT", "CLERK_JWT_KEY", "CREDENTIALS_KEK", "OWNER_ID", "RELEASE_BASE_URL", "SESSION_SECRET", "TRUSTED_ORIGINS"])
    expect((upload.body as { migrations: unknown }).migrations).toMatchObject({ new_tag: "v2", steps: [{ tag: "v1" }, { tag: "v2" }] })
    expect(upload.body).not.toHaveProperty("keep_bindings")
    expect(result).toEqual({ backendUrl: "https://kiko.me.workers.dev", version: "0.1.0" })
    expect(metadata).toEqual([["user_1", { backendUrl: "https://kiko.me.workers.dev", accountId: "acc1", version: "0.1.0" }]])
    expect(calls.some((c) => c.url.endsWith("/subdomain") && c.method === "POST" && JSON.stringify(c.body) === '{"enabled":true,"previews_enabled":false}')).toBe(true)
  })

  test("second run keeps secrets, never regenerates the two keys, and sends only later migration steps", async () => {
    const release = await makeRelease()
    const { upload, calls } = await install({ release, scripts: [{ id: "kiko", migration_tag: "v1" }], r2: "exists" })
    const body = upload.body as { keep_bindings: string[]; migrations: unknown }
    expect(body.keep_bindings).toEqual(["secret_text"])
    expect(secretNames(upload)).toEqual([])
    expect(body.migrations).toEqual({ old_tag: "v1", new_tag: "v2", steps: [{ tag: "v2", deleted_classes: ["WorkDO"] }] })
    const secretPuts = calls.filter((c) => c.url.endsWith("/secrets")).map((c) => (c.body as { name: string }).name)
    expect(secretPuts).toEqual(["OWNER_ID", "CLERK_JWT_KEY", "TRUSTED_ORIGINS", "RELEASE_BASE_URL", "CF_GRANT"])
  })

  test("a kiko script owned by someone else's app gets our own name", async () => {
    const release = await makeRelease()
    const { calls, fetcher } = fakeCloudflare({ release, scripts: [{ id: "kiko" }] })
    const other: typeof fetcher = async (input, init) => (input === "https://kiko.me.workers.dev/api/version" ? new Response("not kiko", { status: 404 }) : fetcher(input, init))
    await runInstall(env(release), { fetch: other, randomSecret: () => "r", sleep: async () => {}, setMetadata: async () => {} }, { sub: "user_1", grant: { kind: "token", token: "t" } }).catch(() => {})
    const put = calls.find((c) => c.method === "PUT")
    expect(put?.url).toMatch(/\/workers\/scripts\/kiko-[0-9a-f]{6}$/)
  })

  test("oauth exchanges the code and stores both tokens in CF_GRANT", async () => {
    const release = await makeRelease()
    const { upload, calls } = await install({ release, scripts: [] }, { kind: "oauth", code: "c", verifier: "v", redirectUri: "https://app.kiko.codes/cb" })
    expect(calls[0]?.url).toBe("https://dash.cloudflare.com/oauth2/token")
    const grant = ((upload.body as { bindings: { name: string; text?: string }[] }).bindings.find((b) => b.name === "CF_GRANT") as { text: string }).text
    expect(JSON.parse(grant)).toEqual({ kind: "oauth", clientId: expect.any(String), accessToken: "at", refreshToken: "rt", accountId: "acc1", scriptName: "kiko" })
  })

  test("R2 not enabled fails with r2_disabled before any upload", async () => {
    const release = await makeRelease()
    const { fetcher, calls } = fakeCloudflare({ release, scripts: [], r2: "disabled" })
    const err = await runInstall(env(release), { fetch: fetcher, randomSecret: () => "r", sleep: async () => {}, setMetadata: async () => {} }, { sub: "u", grant: { kind: "token", token: "t" } }).catch((e) => e)
    expect(err.code).toBe("r2_disabled")
    expect(err.message).toBe("Turn on R2 in your Cloudflare dashboard, then try again.")
    expect(calls.some((c) => c.method === "PUT")).toBe(false)
  })

  test.each(["manifest", "module"] as const)("a tampered %s is rejected before any upload", async (tamper: "manifest" | "module") => {
    const release = await makeRelease(tamper)
    const { fetcher, calls } = fakeCloudflare({ release, scripts: [] })
    const err = await runInstall(env(release), { fetch: fetcher, randomSecret: () => "r", sleep: async () => {}, setMetadata: async () => {} }, { sub: "u", grant: { kind: "token", token: "t" } }).catch((e) => e)
    expect(err.code).toBe("release_untrusted")
    expect(calls.some((c) => c.method === "PUT")).toBe(false)
  })
})
