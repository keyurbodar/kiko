import { describe, expect, test } from "bun:test"
import { ownScriptName } from "./plan"
import { isBlocking } from "./cf"
import { type InstallEnv, runInstall } from "./install"

const enc = new TextEncoder()
const MANIFEST_MODULE = "index.js"
const NEW_SCRIPT = await ownScriptName("user_1", 32)
const OTHER_SCRIPT = await ownScriptName("u", 32)

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

function fakeCloudflare(opts: { release: Awaited<ReturnType<typeof makeRelease>>; scripts: { id: string; migration_tag?: string }[]; r2?: "ok" | "exists" | "disabled"; subdomain?: string | null; accounts?: string[]; deniedAccounts?: string[]; scriptsByAccount?: Record<string, { id: string }[]>; status?: { path: string; code: number; error?: number; message?: string }; dnsAfter?: number; owners?: Record<string, string>; ownerStatus?: number }) {
  let dnsAsks = 0
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
    if (url.host === "cloudflare-dns.com" || url.host === "dns.google") {
      dnsAsks++
      return Response.json(dnsAsks > (opts.dnsAfter ?? 0) ? { Status: 0, Answer: [{ data: "104.21.0.1" }] } : { Status: 3 })
    }
    if (url.host.endsWith(".workers.dev")) {
      if (url.pathname === "/api/auth/clerk") {
        const owner = opts.owners?.[url.host.split(".")[0] ?? ""]
        const status = opts.ownerStatus ?? (owner && owner !== (body as { token: string }).token ? 403 : 200)
        return Response.json(status === 200 ? { user: { id: "owner" }, token: "session" } : { message: "This backend belongs to someone else" }, { status })
      }
      return Response.json({ version: "0.1.0" })
    }
    const path = url.pathname.replace("/client/v4", "")
    if (opts.status && path.endsWith(opts.status.path)) return Response.json({ success: false, errors: [{ code: opts.status.error ?? 1000, message: opts.status.message ?? "Cloudflare says no" }] }, { status: opts.status.code })
    if (opts.deniedAccounts?.some((a) => path.startsWith(`/accounts/${a}/`))) return Response.json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }, { status: 403 })
    if (path === "/accounts") return ok((opts.accounts ?? ["acc1"]).map((id) => ({ id, name: `${id} name` })))
    if (method === "GET" && path.endsWith("/workers/scripts")) {
      const account = path.split("/")[2] ?? ""
      if (opts.scriptsByAccount?.[account]) return ok(opts.scriptsByAccount[account])
    }
    if (path.endsWith("/workers/subdomain")) {
      if (method === "PUT") return ok({ subdomain: (body as { subdomain: string }).subdomain })
      return opts.subdomain === null ? fail(10007, "This account does not have a workers.dev subdomain") : ok({ subdomain: opts.subdomain ?? "me" })
    }
    if (path.endsWith("/r2/buckets")) {
      if (opts.r2 === "disabled") return fail(10042, "Please enable R2 through the Cloudflare Dashboard.")
      return opts.r2 === "exists" ? fail(10073, "Bucket name already exists") : ok({})
    }
    if (path.endsWith("/workers/scripts") && method === "GET") return ok(opts.scripts)
    return ok({})
  }
  return { calls, fetcher }
}

function env(release: { x: string }): InstallEnv {
  return { CF_OAUTH_CLIENT_ID: "cid", CLERK_JWT_KEY: "PEM", FRONT_DOOR_ORIGIN: "https://app.kiko.codes", RELEASE_BASE_URL: "https://release.test", RELEASE_PUBLIC_KEY: release.x }
}

async function install(cfg: Parameters<typeof fakeCloudflare>[0], grant: Parameters<typeof runInstall>[2]["grant"] = { kind: "token", token: "tok" }, accountId?: string) {
  const { calls, fetcher } = fakeCloudflare(cfg)
  const metadata: unknown[] = []
  let n = 0
  const result = await runInstall(env(cfg.release), { fetch: fetcher, randomSecret: () => `rand${n++}`, sleep: async () => {}, setMetadata: async (sub, m) => void metadata.push([sub, m]) }, { clerkToken: "user_1", sub: "user_1", grant, ...(accountId ? { accountId } : {}) })
  const upload = calls.find((c) => c.method === "PUT" && /\/workers\/scripts\/[^/]+$/.test(c.url)) as Call
  return { calls, upload, result, metadata }
}

const secretNames = (upload: Call) => ((upload.body as { bindings: { type: string; name: string }[] }).bindings).filter((b) => b.type === "secret_text").map((b) => b.name)

describe("runInstall", () => {
  test("another Clerk owner cannot rebind the default Kiko Worker", async () => {
    const release = await makeRelease()
    const { calls, result } = await install({ release, scripts: [{ id: "kiko" }], owners: { kiko: "other_owner" } })
    expect(calls.some((c) => c.url === "https://kiko.me.workers.dev/api/auth/clerk")).toBe(true)
    expect(result.backendUrl).toBe(`https://${await ownScriptName("user_1", 32)}.me.workers.dev`)
    expect(calls.filter((c) => c.method === "PUT" && /\/scripts\/kiko(?:\/|$)/.test(c.url))).toEqual([])
  })

  test("an existing owner-specific backend wins over the default and retains its data", async () => {
    const release = await makeRelease()
    const ours = await ownScriptName("user_1")
    const { calls, result } = await install({ release, scripts: [{ id: "kiko" }, { id: ours, migration_tag: "v1" }] })
    expect(result.backendUrl).toBe(`https://${ours}.me.workers.dev`)
    const upload = calls.find((c) => c.method === "PUT" && c.url.endsWith(`/scripts/${ours}`))
    expect(upload?.body).toMatchObject({ keep_bindings: ["secret_text"], migrations: { old_tag: "v1" } })
    expect(calls.filter((c) => c.method === "PUT" && /\/scripts\/kiko(?:\/|$)/.test(c.url))).toEqual([])
  })

  test("an owner-specific name collision is refused without touching either backend", async () => {
    const release = await makeRelease()
    const ours = await ownScriptName("user_1", 32)
    const { calls, fetcher } = fakeCloudflare({ release, scripts: [{ id: "kiko" }, { id: ours }], owners: { kiko: "other", [ours]: "collision" } })
    const failure = await runInstall(env(release), { fetch: fetcher, randomSecret: () => "r", sleep: async () => {}, setMetadata: async () => {} }, { sub: "user_1", clerkToken: "user_1", grant: { kind: "token", token: "t" } }).catch((e) => e)
    expect(failure.code).toBe("owner_conflict")
    expect(calls.filter((c) => c.method === "PUT")).toEqual([])
  })

  test.each([401, 500])("uncertain ownership (%s) stops before any upload", async (ownerStatus) => {
    const release = await makeRelease()
    const { calls, fetcher } = fakeCloudflare({ release, scripts: [{ id: "kiko" }], ownerStatus })
    const failure = await runInstall(env(release), { fetch: fetcher, randomSecret: () => "r", sleep: async () => {}, setMetadata: async () => {} }, { sub: "user_1", clerkToken: "user_1", grant: { kind: "token", token: "t" } }).catch((e) => e)
    expect(failure.code).toBe("owner_unverified")
    expect(calls.filter((c) => c.method === "PUT")).toEqual([])
  })

  test("a backend without Clerk ownership support is left untouched", async () => {
    const release = await makeRelease()
    const { calls, result } = await install({ release, scripts: [{ id: "kiko" }], ownerStatus: 404 })
    expect(result.backendUrl).toBe(`https://${NEW_SCRIPT}.me.workers.dev`)
    expect(calls.filter((c) => c.method === "PUT" && /\/scripts\/kiko(?:\/|$)/.test(c.url))).toEqual([])
  })

  test("a foreign default backend does not choose a team account for the caller", async () => {
    const release = await makeRelease()
    const failure = await install({ release, scripts: [], accounts: ["team", "mine"], scriptsByAccount: { team: [{ id: "kiko" }] }, owners: { kiko: "other" } }).catch((e) => e)
    expect(failure.code).toBe("choose_account")
  })

  test("fresh installs use different names for different Clerk identities", async () => {
    const release = await makeRelease()
    const { fetcher, calls } = fakeCloudflare({ release, scripts: [] })
    const deps = { fetch: fetcher, randomSecret: () => "r", sleep: async () => {}, setMetadata: async () => {} }
    const results = await Promise.all(["one", "two"].map((sub) => runInstall(env(release), deps, { sub, clerkToken: sub, grant: { kind: "token", token: "t" } })))
    expect(results[0]?.backendUrl).not.toBe(results[1]?.backendUrl)
    expect(calls.filter((c) => c.method === "PUT" && /\/scripts\/kiko$/.test(c.url))).toEqual([])
  })

  test("an account with no workers.dev address gets one made for it", async () => {
    const release = await makeRelease()
    const { calls, result } = await install({ release, scripts: [], subdomain: null })
    const made = calls.find((c) => c.method === "PUT" && c.url.endsWith("/workers/subdomain"))
    const label = (made?.body as { subdomain: string } | undefined)?.subdomain ?? ""
    expect(label).toMatch(/^kiko-[0-9a-f]{8}$/)
    expect(result.backendUrl).toBe(`https://${NEW_SCRIPT}.${label}.workers.dev`)
  })

  test("an account that has a workers.dev address keeps it", async () => {
    const release = await makeRelease()
    const { calls } = await install({ release, scripts: [] })
    expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/workers/subdomain"))).toBe(false)
  })

  test("first install sets the six secrets and the full migration list", async () => {
    const release = await makeRelease()
    const { upload, result, metadata, calls } = await install({ release, scripts: [] })
    expect(secretNames(upload).sort()).toEqual(["CF_GRANT", "CLERK_JWT_KEY", "CREDENTIALS_KEK", "OWNER_ID", "RELEASE_BASE_URL", "SESSION_SECRET", "TRUSTED_ORIGINS"])
    expect((upload.body as { migrations: unknown }).migrations).toMatchObject({ new_tag: "v2", steps: [{ tag: "v1" }, { tag: "v2" }] })
    expect(upload.body).not.toHaveProperty("keep_bindings")
    expect(result).toEqual({ backendUrl: `https://${NEW_SCRIPT}.me.workers.dev`, version: "0.1.0" })
    expect(metadata).toEqual([["user_1", { backendUrl: `https://${NEW_SCRIPT}.me.workers.dev`, accountId: "acc1", version: "0.1.0" }]])
    expect(calls.some((c) => c.url.endsWith("/subdomain") && c.method === "POST" && JSON.stringify(c.body) === '{"enabled":true,"previews_enabled":false}')).toBe(true)
  })

  test("second run keeps secrets, never regenerates the two keys, and sends only later migration steps", async () => {
    const release = await makeRelease()
    const { upload, calls } = await install({ release, scripts: [{ id: "kiko", migration_tag: "v1" }], r2: "exists" })
    const body = upload.body as { keep_bindings: string[]; migrations: unknown; bindings: { type: string; name: string }[] }
    expect(body.keep_bindings).toEqual(["secret_text"])
    expect(body.bindings.filter((b) => b.name === "FILES")).toEqual([{ type: "inherit", name: "FILES" }])
    expect(calls.some((c) => c.url.endsWith("/r2/buckets"))).toBe(false)
    expect(secretNames(upload)).toEqual([])
    expect(body.migrations).toEqual({ old_tag: "v1", new_tag: "v2", steps: [{ tag: "v2", deleted_classes: ["WorkDO"] }] })
    const secretPuts = calls.filter((c) => c.url.endsWith("/secrets")).map((c) => (c.body as { name: string }).name)
    expect(secretPuts).toEqual(["OWNER_ID", "CLERK_JWT_KEY", "TRUSTED_ORIGINS", "RELEASE_BASE_URL", "CF_GRANT"])
  })

  test("a kiko script owned by someone else's app gets our own name", async () => {
    const release = await makeRelease()
    const { calls, fetcher } = fakeCloudflare({ release, scripts: [{ id: "kiko" }] })
    const other: typeof fetcher = async (input, init) => (input.startsWith("https://kiko.me.workers.dev/api/") ? new Response("not kiko", { status: 404 }) : fetcher(input, init))
    await runInstall(env(release), { fetch: other, randomSecret: () => "r", sleep: async () => {}, setMetadata: async () => {} }, { clerkToken: "user_1", sub: "user_1", grant: { kind: "token", token: "t" } }).catch(() => {})
    const put = calls.find((c) => c.method === "PUT")
    expect(put?.url).toMatch(/\/workers\/scripts\/kiko-[0-9a-f]{32}$/)
  })

  test("oauth exchanges the code and stores both tokens in CF_GRANT", async () => {
    const release = await makeRelease()
    const { upload, calls } = await install({ release, scripts: [] }, { kind: "oauth", code: "c", verifier: "v", redirectUri: "https://app.kiko.codes/cb" })
    expect(calls[0]?.url).toBe("https://dash.cloudflare.com/oauth2/token")
    const grant = ((upload.body as { bindings: { name: string; text?: string }[] }).bindings.find((b) => b.name === "CF_GRANT") as { text: string }).text
    expect(JSON.parse(grant)).toEqual({ kind: "oauth", clientId: expect.any(String), accessToken: "at", refreshToken: "rt", accountId: "acc1", scriptName: NEW_SCRIPT })
  })

  const storageBindings = (upload: Call) => ((upload.body as { bindings: { type: string; name: string }[] }).bindings).filter((b) => b.type === "durable_object_namespace" || b.name === "FILES")

  for (const r2 of ["ok", "exists", "disabled"] as const) {
    test(`fresh backends keep files private when R2 is ${r2}`, async () => {
      const release = await makeRelease()
      const { upload, calls, result } = await install({ release, scripts: [], r2 })
      expect(storageBindings(upload)).toEqual([{ type: "durable_object_namespace", name: "OWNER", class_name: "OwnerDO" }])
      expect(calls.some((c) => c.url.endsWith("/r2/buckets"))).toBe(false)
      expect(result.backendUrl).toBe(`https://${NEW_SCRIPT}.me.workers.dev`)
    })
  }

  test("an account the sign-in cannot use is skipped for the next one", async () => {
    const release = await makeRelease()
    const { calls, result } = await install({ release, scripts: [], accounts: ["team", "mine"], deniedAccounts: ["team"] })
    expect(result.version).toBe("0.1.0")
    expect(calls.some((c) => c.url.includes("/accounts/mine/workers/scripts/kiko"))).toBe(true)
  })

  test("several usable accounts and none chosen: the person picks, and nothing is uploaded", async () => {
    const release = await makeRelease()
    const err = await install({ release, scripts: [], accounts: ["team", "mine"] }).catch((e) => e)
    expect(err).toMatchObject({ code: "choose_account", accounts: [{ id: "team", name: "team name" }, { id: "mine", name: "mine name" }] })
  })

  test("the chosen account is the one installed into", async () => {
    const release = await makeRelease()
    const { calls } = await install({ release, scripts: [], accounts: ["team", "mine"] }, undefined, "mine")
    expect(calls.some((c) => c.method === "PUT" && c.url.includes("/accounts/mine/workers/scripts/kiko"))).toBe(true)
  })

  test("after picking an account, the same OAuth code installs without being traded twice", async () => {
    const release = await makeRelease()
    const { calls, fetcher } = fakeCloudflare({ release, scripts: [], accounts: ["team", "mine"] })
    const kept = new Map<string, { accessToken: string; refreshToken?: string }>()
    const take = async (c: string) => {
      const t = kept.get(c)
      kept.delete(c)
      return t
    }
    const codes = { take, put: async (c: string, t: { accessToken: string }) => void kept.set(c, t) }
    const deps = { fetch: fetcher, randomSecret: () => "r", sleep: async () => {}, setMetadata: async () => {}, codes }
    const grant = { kind: "oauth", code: "c", verifier: "v", redirectUri: "https://app.kiko.codes/cb" } as const
    expect(await runInstall(env(release), deps, { clerkToken: "user_1", sub: "u", grant }).catch((e) => e.code)).toBe("choose_account")
    expect((await runInstall(env(release), deps, { clerkToken: "user_1", sub: "u", grant, accountId: "mine" })).version).toBe("0.1.0")
    expect(calls.filter((c) => c.url === "https://dash.cloudflare.com/oauth2/token")).toHaveLength(1)
    expect(kept.size).toBe(0)
  })

  test("an OAuth sign-in that fails for any other reason keeps nothing", async () => {
    const release = await makeRelease()
    const { fetcher } = fakeCloudflare({ release, scripts: [], status: { path: "/workers/scripts", code: 503 } })
    const kept = new Map<string, unknown>()
    const codes = { take: async () => undefined, put: async (c: string, t: unknown) => void kept.set(c, t) }
    const deps = { fetch: fetcher, randomSecret: () => "r", sleep: async () => {}, setMetadata: async () => {}, codes }
    const grant = { kind: "oauth", code: "c", verifier: "v", redirectUri: "https://app.kiko.codes/cb" } as const
    expect(await runInstall(env(release), deps, { clerkToken: "user_1", sub: "u", grant }).catch((e) => e.code)).toBe("cloudflare_down")
    expect(kept.size).toBe(0)
  })

  test("a token Cloudflare does not know is a bad token, not a missing permission, and an OAuth one means sign in again", async () => {
    const release = await makeRelease()
    const status = { path: "/accounts", code: 403, error: 9109, message: "Invalid access token" }
    const token = await install({ release, scripts: [], status }).catch((e) => e)
    expect([token.code, token.detail]).toEqual(["bad_token", "Invalid access token (GET /accounts)"])
    const { fetcher } = fakeCloudflare({ release, scripts: [], status })
    const deps = { fetch: fetcher, randomSecret: () => "r", sleep: async () => {}, setMetadata: async () => {} }
    const grant = { kind: "oauth", code: "c", verifier: "v", redirectUri: "https://app.kiko.codes/cb" } as const
    expect(await runInstall(env(release), deps, { clerkToken: "user_1", sub: "u", grant }).catch((e) => e.code)).toBe("oauth_failed")
    const garbage = await install({ release, scripts: [], status: { path: "/accounts", code: 400, error: 6003, message: "Invalid request headers" } }).catch((e) => e)
    expect(garbage.code).toBe("bad_token")
  })

  test("an account that already runs Kiko is used without asking", async () => {
    const release = await makeRelease()
    const { calls } = await install({ release, scripts: [], accounts: ["team", "mine"], scriptsByAccount: { mine: [{ id: "kiko" }] } })
    expect(calls.some((c) => c.method === "PUT" && c.url.includes("/accounts/mine/workers/scripts/kiko"))).toBe(true)
  })

  test("a token that may edit but not create Workers is told to use Workers Admin, with Cloudflare's words", async () => {
    const release = await makeRelease()
    const err = await install({ release, scripts: [], status: { path: `/workers/scripts/${NEW_SCRIPT}`, code: 403, error: 10000 } }).catch((e) => e)
    expect(err.code).toBe("cannot_create")
    expect(err.message).toContain("Workers Admin")
    expect(err.detail).toContain("Cloudflare says no")
  })

  test("a fresh workers.dev address is not handed out until public resolvers see it", async () => {
    const release = await makeRelease()
    const { calls } = await install({ release, scripts: [], subdomain: null, dnsAfter: 4 })
    const asks = calls.filter((c) => c.url.includes("dns")).length
    expect(asks).toBeGreaterThanOrEqual(6)
    expect(calls.findIndex((c) => c.url.includes("dns"))).toBeGreaterThan(calls.findIndex((c) => c.url.includes("/api/version")))
  })

  test("an address that existed before is not checked", async () => {
    const release = await makeRelease()
    const { calls } = await install({ release, scripts: [] })
    expect(calls.some((c) => c.url.includes("dns"))).toBe(false)
  })

  test.each([
    ["every account denies the sign-in", { accounts: ["team"], deniedAccounts: ["team"] }, "no_permission"],
    ["Cloudflare says slow down", { status: { path: "/workers/scripts", code: 429 } }, "busy"],
    ["Cloudflare is down", { status: { path: "/workers/scripts", code: 503 } }, "cloudflare_down"],
    ["the account has used its free Durable Object rows", { status: { path: "/workers/scripts", code: 500, message: "Exceeded allowed rows written in Durable Objects free tier" } }, "storage_full"],
    ["the account has used its free Durable Object rows read", { status: { path: "/accounts", code: 500, message: "exceeded allowed rows read in durable objects free tier" } }, "storage_full"],
    ["the subdomain call is denied, not missing", { subdomain: null, status: { path: "/workers/subdomain", code: 403, error: 10000 } }, "no_permission"],
    ["the upload of a new Worker is denied", { status: { path: `/workers/scripts/${OTHER_SCRIPT}`, code: 403 } }, "cannot_create"],
    ["the upload over an existing Kiko is denied", { scripts: [{ id: "kiko" }], status: { path: "/workers/scripts/kiko", code: 403 } }, "no_permission"],
    ["the account list is empty", { accounts: [] }, "no_account"],
  ] as const)("%s maps to %s", async (_name, extra, code) => {
    const release = await makeRelease()
    const { fetcher } = fakeCloudflare({ release, scripts: [], ...(extra as object) } as Parameters<typeof fakeCloudflare>[0])
    const err = await runInstall(env(release), { fetch: fetcher, randomSecret: () => "r", sleep: async () => {}, setMetadata: async () => {} }, { clerkToken: "user_1", sub: "u", grant: { kind: "token", token: "t" } }).catch((e) => e)
    expect(err.code).toBe(code)
  })

  test("the free Durable Object row limit says what happened, when it resets, and keeps Cloudflare's words", async () => {
    const release = await makeRelease()
    const err = await install({ release, scripts: [], status: { path: "/workers/scripts", code: 500, message: "Exceeded allowed rows written in Durable Objects free tier" } }).catch((e) => e)
    expect(err.code).toBe("storage_full")
    expect(err.message).toContain("free daily allowance")
    expect(err.message).toContain("00:00 UTC")
    expect(err.detail).toContain("Exceeded allowed rows written")
    expect(isBlocking(err)).toBe(true)
  })

  test.each(["manifest", "module"] as const)("a tampered %s is rejected before any upload", async (tamper: "manifest" | "module") => {
    const release = await makeRelease(tamper)
    const { fetcher, calls } = fakeCloudflare({ release, scripts: [] })
    const err = await runInstall(env(release), { fetch: fetcher, randomSecret: () => "r", sleep: async () => {}, setMetadata: async () => {} }, { clerkToken: "user_1", sub: "u", grant: { kind: "token", token: "t" } }).catch((e) => e)
    expect(err.code).toBe("release_untrusted")
    expect(calls.some((c) => c.method === "PUT")).toBe(false)
  })
})
