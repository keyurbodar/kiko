import { assert, describe, it } from "@effect/vitest"
import type { ScriptBinding } from "@kiko/durable/cloudflare"
import { sha256Hex } from "@kiko/durable/hash"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Clerk, clerkRest } from "./clerk"
import { answerReply, exitReply } from "./handler"
import { CodeCache, Http, InstallerConfig, type InstallRequest, makeInstaller, type OAuthTokens } from "./install"

const VERSION = "2.0.0"
const API_TOKEN = "api-token"
const OAUTH_ACCESS = "oauth-access"

type FakeScript = { tag: string | null; modified: string; bindings: ScriptBinding[] }
type FakeAccount = {
  id: string
  name?: string
  subdomain: string | null
  scripts: Record<string, FakeScript>
  refuses?: "listing" | "creating" | "builder"
}
type FakeUser = { email: string; metadata: Record<string, unknown> }
type Upload = { account: string; script: string; bindings: UploadedBinding[]; migrations: unknown }
type UploadedBinding = { type: string; name: string; text?: string; class_name?: string }
type Reply = { status: number; body: Record<string, unknown> & { error?: Record<string, unknown> } }

const OWNER_DO = { type: "durable_object_namespace", name: "OWNER", class_name: "OwnerDO" }
const secret = (name: string): ScriptBinding => ({ type: "secret_text", name })

const kikoScript = (owner: ScriptBinding, tag = "v5", modified = "2026-10-01T00:00:00Z"): FakeScript => ({
  tag,
  modified,
  bindings: [
    OWNER_DO,
    owner,
    secret("SESSION_SECRET"),
    secret("CREDENTIALS_KEK"),
    secret("CF_GRANT"),
    secret("CLERK_JWT_KEY"),
    secret("TRUSTED_ORIGINS"),
    secret("RELEASE_BASE_URL"),
    { type: "r2_bucket", name: "FILES" },
  ],
})
const ownedBy = (sub: string, tag?: string, modified?: string) =>
  kikoScript({ type: "plain_text", name: "OWNER_ID", text: sub }, tag, modified)
const unclaimed = (tag?: string) => kikoScript(secret("OWNER_ID"), tag)
const foreign = (): FakeScript => ({ tag: "x", modified: "2026-01-01T00:00:00Z", bindings: [secret("API_KEY")] })

const BUILDER_CODE = "export class Builder {}"

const signedReleaseWith = (withBuilder: boolean) =>
  Effect.promise(async () => {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
    const publicKey = ((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey).x as string
    const module = new TextEncoder().encode("export default {}")
    const manifest = new TextEncoder().encode(
      JSON.stringify({
        version: VERSION,
        protocol: 3,
        main_module: "index.js",
        compatibility_date: "2026-09-01",
        compatibility_flags: [],
        durable_objects: [{ name: "OWNER", class_name: "OwnerDO" }],
        migrations: [{ tag: "v5", new_sqlite_classes: ["OwnerDO"] }],
        modules: [{ name: "index.js", type: "application/javascript+module", sha256: await sha256Hex(module) }],
        ...(withBuilder
          ? {
              builder: {
                main_module: "index.js",
                compatibility_date: "2026-09-01",
                compatibility_flags: [],
                durable_objects: [{ name: "BUILDER", class_name: "Builder" }],
                migrations: [{ tag: "v1", new_sqlite_classes: ["Builder"] }],
                modules: [
                  {
                    name: "index.js",
                    type: "application/javascript+module",
                    sha256: await sha256Hex(new TextEncoder().encode(BUILDER_CODE)),
                  },
                ],
              },
            }
          : {}),
      }),
    )
    const signature = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, manifest))
    const files: Record<string, Uint8Array | string> = {
      "/latest-owner.json": JSON.stringify({ version: VERSION }),
      [`/${VERSION}/manifest.json`]: manifest,
      [`/${VERSION}/manifest.sig`]: signature.toString("base64"),
      [`/${VERSION}/index.js`]: module,
      ...(withBuilder ? { [`/${VERSION}/builder/index.js`]: BUILDER_CODE } : {}),
    }
    return { publicKey, files }
  })

const signedRelease = signedReleaseWith(false)

const ok = (result: unknown) => Response.json({ success: true, result })
const refusal = (status: number, code: number, message: string) =>
  Response.json({ success: false, errors: [{ code, message }] }, { status })

function makeWorld(input: {
  accounts: FakeAccount[]
  users?: Record<string, FakeUser>
  oauth?: "accepts" | "refuses"
  busy?: boolean
}) {
  const accounts = input.accounts
  const users = new Map<string, FakeUser>(
    Object.entries({ user_a: { email: "ann@example.com", metadata: {} }, ...input.users }),
  )
  const uploads: Upload[] = []
  const writes: string[] = []
  let exchanges = 0
  let clock = 0
  const account = (id: string | undefined) => accounts.find((candidate) => candidate.id === id)

  const upload = async (owner: FakeAccount, name: string, body: FormData) => {
    const metadata = JSON.parse(await new Response(body.get("metadata")).text()) as {
      bindings: UploadedBinding[]
      migrations: { new_tag: string }
    }
    const existing = owner.scripts[name]
    if (!existing && owner.refuses === "creating") return refusal(403, 10000, "Authentication error")
    if (name.endsWith("-builder") && owner.refuses === "builder") return refusal(500, 10013, "builder refused")
    const resolved = metadata.bindings.map((binding) =>
      binding.type === "inherit"
        ? existing?.bindings.find((kept) => kept.name === binding.name)
        : binding.type === "secret_text"
          ? { type: "secret_text", name: binding.name }
          : binding,
    )
    if (resolved.some((binding) => binding === undefined)) return refusal(400, 10021, "inherit of a missing binding")
    uploads.push({ account: owner.id, script: name, bindings: metadata.bindings, migrations: metadata.migrations })
    clock += 1
    owner.scripts[name] = {
      tag: metadata.migrations.new_tag,
      modified: `2026-10-24T00:00:0${clock}Z`,
      bindings: resolved as ScriptBinding[],
    }
    return ok({})
  }

  const scriptApi = async (owner: FakeAccount, method: string, path: string[], init: RequestInit) => {
    const [name = "", leaf] = path
    const script = owner.scripts[name]
    if (leaf === "settings") return script ? ok({ bindings: script.bindings }) : refusal(404, 10007, "not found")
    if (leaf === "subdomain") return ok({})
    if (method !== "DELETE") return upload(owner, name, init.body as FormData)
    delete owner.scripts[name]
    return ok({})
  }

  const accountApi = async (owner: FakeAccount, method: string, path: string[], init: RequestInit) => {
    const [kind, ...rest] = path
    if (kind === "subdomain") {
      if (method === "PUT") owner.subdomain = "fresh-address"
      return owner.subdomain ? ok({ subdomain: owner.subdomain }) : refusal(404, 10007, "no subdomain")
    }
    if (rest.length > 0) return scriptApi(owner, method, rest, init)
    if (owner.refuses === "listing") return refusal(403, 10000, "Authentication error")
    if (input.busy) return refusal(429, 971, "Please wait and consider throttling your request speed")
    return ok(
      Object.entries(owner.scripts).map(([script, value]) => ({
        id: script,
        ...(value.tag ? { migration_tag: value.tag } : {}),
        modified_on: value.modified,
      })),
    )
  }

  const cloudflareApi = async (method: string, path: string, init: RequestInit) => {
    const bearer = new Headers(init.headers).get("Authorization")
    if (bearer !== `Bearer ${API_TOKEN}` && bearer !== `Bearer ${OAUTH_ACCESS}`)
      return refusal(400, 6003, "Invalid request headers")
    if (method !== "GET") writes.push(`${method} ${path}`)
    if (path === "/accounts")
      return ok(accounts.map((candidate) => ({ id: candidate.id, name: candidate.name ?? candidate.id })))
    const [, id, , ...rest] = (path.split("?")[0] ?? "").split("/").slice(1)
    const owner = account(id)
    return owner ? accountApi(owner, method, rest, init) : refusal(404, 7003, "Could not route to /accounts")
  }

  const clerkApi = async (method: string, path: string, init: RequestInit) => {
    const [, , id] = path.split("/").slice(1)
    const user = users.get(decodeURIComponent(id ?? ""))
    if (!user) return Response.json({ errors: [{ code: "resource_not_found" }] }, { status: 404 })
    if (method === "PATCH") {
      const { public_metadata: changes } = JSON.parse(String(init.body)) as {
        public_metadata: Record<string, unknown>
      }
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete user.metadata[key]
        else user.metadata[key] = value
      }
    }
    return Response.json({
      id,
      primary_email_address_id: "email_1",
      email_addresses: [{ id: "email_1", email_address: user.email }],
      public_metadata: user.metadata,
    })
  }

  const fetch = async (target: string, init: RequestInit = {}) => {
    const url = new URL(target)
    const method = init.method ?? "GET"
    if (url.host === "api.cloudflare.com")
      return cloudflareApi(method, url.pathname.replace("/client/v4", "") + url.search, init)
    if (url.host === "api.clerk.com") return clerkApi(method, url.pathname, init)
    if (url.host === "dash.cloudflare.com") {
      exchanges += 1
      return input.oauth === "refuses"
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : Response.json({ access_token: OAUTH_ACCESS, refresh_token: "oauth-refresh" })
    }
    if (url.host === "cloudflare-dns.com" || url.host === "dns.google")
      return Response.json({ Status: 0, Answer: [{}] })
    const [script, subdomain] = url.host.split(".")
    if (url.host.endsWith(".workers.dev") && url.pathname === "/api/version") {
      const live = accounts.some(
        (candidate) => candidate.subdomain === subdomain && script && candidate.scripts[script],
      )
      return live
        ? Response.json({ kiko: 1, version: VERSION, protocol: 3, selfUpdate: true })
        : new Response("not found", { status: 404 })
    }
    throw new TypeError(`unexpected fetch ${target}`)
  }

  const codes = new Map<string, OAuthTokens>()
  let randomCalls = 0
  const services = (publicKey: string) =>
    Layer.mergeAll(
      Layer.succeed(Http, Http.of({ fetch })),
      Layer.succeed(
        InstallerConfig,
        InstallerConfig.of({
          oauthClientId: "client",
          releaseBase: "https://releases.test",
          releasePublicKey: publicKey,
          random: () => new Uint8Array(32).fill((randomCalls += 1)),
        }),
      ),
      Layer.succeed(Clerk, clerkRest({ secretKey: "sk_test", fetch })),
      Layer.succeed(
        CodeCache,
        CodeCache.of({
          recall: (code) => Effect.sync(() => codes.get(code) ?? null),
          remember: (code, tokens) => Effect.sync(() => void codes.set(code, tokens)),
          forget: (code) => Effect.sync(() => void codes.delete(code)),
        }),
      ),
    )

  return {
    accounts,
    users,
    uploads,
    writes,
    codes,
    exchanges: () => exchanges,
    fetch,
    services,
  }
}

type World = ReturnType<typeof makeWorld>

const releaseFetch = (world: World, release: Effect.Success<typeof signedRelease>) => {
  const fetch = world.fetch
  return async (target: string, init?: RequestInit) => {
    const url = new URL(target)
    if (url.host !== "releases.test") return fetch(target, init)
    const file = release.files[url.pathname]
    return file === undefined ? new Response("missing", { status: 404 }) : new Response(file)
  }
}

const installerFor = (world: World, withBuilder = false) =>
  Effect.gen(function* () {
    const release = yield* signedReleaseWith(withBuilder)
    const installer = yield* makeInstaller
    const layer = Layer.mergeAll(
      world.services(release.publicKey),
      Layer.succeed(Http, Http.of({ fetch: releaseFetch(world, release) })),
    )
    return {
      install: (request: InstallRequest) =>
        installer.install(request).pipe(
          Effect.provide(layer),
          Effect.exit,
          Effect.map((exit) => exitReply(exit, answerReply) as Reply),
        ),
      detach: (sub: string) =>
        installer.detach(sub).pipe(
          Effect.provide(layer),
          Effect.exit,
          Effect.map((exit) => exitReply(exit, () => ({ status: 204, body: null }))),
        ),
    }
  })

const TOKEN_GRANT = { kind: "token", token: API_TOKEN } as const
const OAUTH_GRANT = { kind: "oauth", code: "code-1", verifier: "verifier", redirectUri: "https://app.test/cb" } as const

const shape = (bindings: ReadonlyArray<UploadedBinding & { service?: string }>) =>
  bindings.map((binding) =>
    binding.type === "plain_text"
      ? `${binding.name}=${binding.text}`
      : binding.type === "service"
        ? `service:${binding.name}=${binding.service}`
        : `${binding.type}:${binding.name}`,
  )

const storedGrant = (upload: Upload | undefined) =>
  JSON.parse(upload?.bindings.find((binding) => binding.name === "CF_GRANT")?.text ?? "null") as Record<string, unknown>

describe("install", () => {
  it.effect("installs a new backend named kiko with its owner in plain text and points the sign-in at it", () =>
    Effect.gen(function* () {
      const world = makeWorld({
        accounts: [{ id: "acc1", subdomain: "owner", scripts: { "kiko-tools": foreign() } }],
        users: { user_a: { email: "ann@example.com", metadata: { backendUrl: "https://old", version: "0.8.0" } } },
      })
      const installer = yield* installerFor(world)
      const reply = yield* installer.install({ sub: "user_a", grant: TOKEN_GRANT })
      assert.deepStrictEqual(reply, {
        status: 200,
        body: { backendUrl: "https://kiko.owner.workers.dev", version: VERSION },
      })
      assert.deepStrictEqual(
        world.uploads.map((upload) => [upload.script, shape(upload.bindings)]),
        [
          [
            "kiko",
            [
              "durable_object_namespace:OWNER",
              "OWNER_ID=user_a",
              "secret_text:CF_GRANT",
              "secret_text:SESSION_SECRET",
              "secret_text:CREDENTIALS_KEK",
            ],
          ],
        ],
      )
      assert.deepInclude(storedGrant(world.uploads[0]), { kind: "token", accountId: "acc1", scriptName: "kiko" })
      assert.deepStrictEqual(world.users.get("user_a")?.metadata, {
        kiko: { v: 1, url: "https://kiko.owner.workers.dev", accountId: "acc1", script: "kiko" },
      })
    }),
  )

  it.effect("redeploys the caller's own backend in place, keeping its secrets and dropping shipped config", () =>
    Effect.gen(function* () {
      const world = makeWorld({ accounts: [{ id: "acc1", subdomain: "owner", scripts: { kiko: ownedBy("user_a") } }] })
      const installer = yield* installerFor(world)
      const reply = yield* installer.install({ sub: "user_a", grant: TOKEN_GRANT })
      assert.strictEqual(reply.status, 200)
      assert.deepStrictEqual(shape(world.uploads[0]?.bindings ?? []), [
        "durable_object_namespace:OWNER",
        "OWNER_ID=user_a",
        "secret_text:CF_GRANT",
        "inherit:SESSION_SECRET",
        "inherit:CREDENTIALS_KEK",
        "inherit:FILES",
      ])
      assert.deepStrictEqual(world.uploads[0]?.migrations, { old_tag: "v5", new_tag: "v5", steps: [] })
    }),
  )

  it.effect("asks before touching another sign-in's backend, then takes it over with its data and a new secret", () =>
    Effect.gen(function* () {
      const world = makeWorld({
        accounts: [{ id: "acc1", subdomain: "owner", scripts: { kiko: ownedBy("user_b") } }],
        users: {
          user_a: { email: "ann@example.com", metadata: {} },
          user_b: {
            email: "bea@example.com",
            metadata: { kiko: { v: 1, url: "https://kiko.owner.workers.dev", accountId: "acc1", script: "kiko" } },
          },
        },
      })
      const installer = yield* installerFor(world)
      const asked = yield* installer.install({ sub: "user_a", grant: OAUTH_GRANT })
      assert.deepStrictEqual(asked.status, 409)
      assert.deepInclude(asked.body.error, {
        code: "decide",
        retry: "same",
        found: { script: "kiko", owner: { _tag: "Other", hint: "b•••@example.com" }, keepable: true },
      })
      assert.deepStrictEqual(world.writes, [])
      const taken = yield* installer.install({ sub: "user_a", grant: OAUTH_GRANT, decision: "take_over" })
      assert.strictEqual(taken.status, 200)
      assert.deepStrictEqual(shape(world.uploads[0]?.bindings ?? []), [
        "durable_object_namespace:OWNER",
        "OWNER_ID=user_a",
        "secret_text:CF_GRANT",
        "secret_text:SESSION_SECRET",
        "inherit:CREDENTIALS_KEK",
        "inherit:FILES",
      ])
      assert.strictEqual(world.exchanges(), 1)
      assert.strictEqual(world.codes.size, 0)
      assert.deepStrictEqual(world.users.get("user_b")?.metadata, {})
      assert.deepInclude(world.users.get("user_a")?.metadata ?? {}, {
        kiko: { v: 1, url: "https://kiko.owner.workers.dev", accountId: "acc1", script: "kiko" },
      })
    }),
  )

  it.effect("treats a Kiko backend whose owner it cannot read as unclaimed and claims it on request", () =>
    Effect.gen(function* () {
      const world = makeWorld({ accounts: [{ id: "acc1", subdomain: "owner", scripts: { kiko: unclaimed() } }] })
      const installer = yield* installerFor(world)
      const asked = yield* installer.install({ sub: "user_a", grant: TOKEN_GRANT })
      assert.deepInclude(asked.body.error, {
        code: "decide",
        found: { script: "kiko", owner: { _tag: "Unknown" }, keepable: true },
      })
      const claimed = yield* installer.install({ sub: "user_a", grant: TOKEN_GRANT, decision: "take_over" })
      assert.strictEqual(claimed.status, 200)
      assert.includeMembers(shape(world.uploads[0]?.bindings ?? []), ["OWNER_ID=user_a", "secret_text:SESSION_SECRET"])
    }),
  )

  it.effect("offers only a fresh start for a backend too old to keep, and deletes it only when asked", () =>
    Effect.gen(function* () {
      const world = makeWorld({
        accounts: [{ id: "acc1", subdomain: "owner", scripts: { "kiko-a1b2c3": unclaimed("v4") } }],
      })
      const installer = yield* installerFor(world)
      const asked = yield* installer.install({ sub: "user_a", grant: TOKEN_GRANT })
      assert.deepInclude(asked.body.error, {
        code: "decide",
        found: { script: "kiko-a1b2c3", owner: { _tag: "Unknown" }, keepable: false },
      })
      const refused = yield* installer.install({ sub: "user_a", grant: TOKEN_GRANT, decision: "take_over" })
      assert.deepInclude(refused.body.error, { code: "not_keepable", retry: "same" })
      assert.deepStrictEqual(world.writes, [])
      const fresh = yield* installer.install({ sub: "user_a", grant: TOKEN_GRANT, decision: "start_fresh" })
      assert.deepStrictEqual(fresh.body, { backendUrl: "https://kiko-a1b2c3.owner.workers.dev", version: VERSION })
      assert.deepStrictEqual(world.writes.slice(0, 2), [
        "DELETE /accounts/acc1/workers/scripts/kiko-a1b2c3?force=true",
        "PUT /accounts/acc1/workers/scripts/kiko-a1b2c3",
      ])
      assert.deepStrictEqual(shape(world.uploads[0]?.bindings ?? []), [
        "durable_object_namespace:OWNER",
        "OWNER_ID=user_a",
        "secret_text:CF_GRANT",
        "secret_text:SESSION_SECRET",
        "secret_text:CREDENTIALS_KEK",
      ])
    }),
  )

  it.effect("never replaces a Worker named kiko that is not Kiko", () =>
    Effect.gen(function* () {
      const world = makeWorld({ accounts: [{ id: "acc1", subdomain: "owner", scripts: { kiko: foreign() } }] })
      const installer = yield* installerFor(world)
      const reply = yield* installer.install({ sub: "user_a", grant: TOKEN_GRANT })
      assert.deepInclude(reply.body.error, { code: "name_taken", retry: "same" })
      assert.deepStrictEqual(world.writes, [])
    }),
  )

  it.effect("goes to the account that holds the caller's backend, and asks which account when none does", () =>
    Effect.gen(function* () {
      const holding = makeWorld({
        accounts: [
          { id: "acc1", subdomain: "one", scripts: {} },
          { id: "acc2", subdomain: "two", scripts: { "kiko-old": ownedBy("user_a") } },
        ],
      })
      const found = yield* (yield* installerFor(holding)).install({ sub: "user_a", grant: TOKEN_GRANT })
      assert.deepStrictEqual(found.body, { backendUrl: "https://kiko-old.two.workers.dev", version: VERSION })
      const neither = makeWorld({
        accounts: [
          { id: "acc1", name: "Home", subdomain: "one", scripts: {} },
          { id: "acc2", name: "Work", subdomain: "two", scripts: {} },
        ],
      })
      const installer = yield* installerFor(neither)
      const asked = yield* installer.install({ sub: "user_a", grant: TOKEN_GRANT })
      assert.deepInclude(asked.body.error, {
        code: "choose_account",
        accounts: [
          { id: "acc1", name: "Home" },
          { id: "acc2", name: "Work" },
        ],
      })
      const chosen = yield* installer.install({ sub: "user_a", grant: TOKEN_GRANT, accountId: "acc2" })
      assert.deepStrictEqual(chosen.body, { backendUrl: "https://kiko.two.workers.dev", version: VERSION })
    }),
  )

  it.effect("names the retry for each failure class", () =>
    Effect.gen(function* () {
      const empty = () => [{ id: "acc1", subdomain: "owner", scripts: {} }]
      const errorOf = (reply: Reply) => [reply.body.error?.code, reply.body.error?.retry]
      const oauthRefused = yield* (yield* installerFor(makeWorld({ accounts: empty(), oauth: "refuses" }))).install({
        sub: "user_a",
        grant: OAUTH_GRANT,
      })
      assert.deepStrictEqual(errorOf(oauthRefused), ["grant_invalid", "new-grant"])
      const unknownToken = yield* (yield* installerFor(makeWorld({ accounts: empty() }))).install({
        sub: "user_a",
        grant: { kind: "token", token: "pasted-wrong" },
      })
      assert.deepStrictEqual(errorOf(unknownToken), ["bad_token", "token"])
      const busy = yield* (yield* installerFor(makeWorld({ accounts: empty(), busy: true }))).install({
        sub: "user_a",
        grant: TOKEN_GRANT,
      })
      assert.deepStrictEqual(errorOf(busy), ["busy", "same"])
      const cannotCreate = yield* (yield* installerFor(
        makeWorld({ accounts: [{ id: "acc1", subdomain: "owner", scripts: {}, refuses: "creating" }] }),
      )).install({ sub: "user_a", grant: TOKEN_GRANT })
      assert.deepStrictEqual(errorOf(cannotCreate), ["cannot_create", "new-grant"])
    }),
  )

  it.effect("serializes two installs by one identity so the second redeploys what the first created", () =>
    Effect.gen(function* () {
      const world = makeWorld({ accounts: [{ id: "acc1", subdomain: "owner", scripts: {} }] })
      const installer = yield* installerFor(world)
      const replies = yield* Effect.all(
        [
          installer.install({ sub: "user_a", grant: TOKEN_GRANT }),
          installer.install({ sub: "user_a", grant: TOKEN_GRANT }),
        ],
        { concurrency: "unbounded" },
      )
      assert.deepStrictEqual(
        replies.map((reply) => reply.status),
        [200, 200],
      )
      assert.deepStrictEqual(
        world.uploads.map((upload) => shape(upload.bindings).find((binding) => binding.endsWith("SESSION_SECRET"))),
        ["secret_text:SESSION_SECRET", "inherit:SESSION_SECRET"],
      )
    }),
  )

  it.effect("detaches only the caller's pointer and leaves the Worker alone", () =>
    Effect.gen(function* () {
      const pointer = { v: 1, url: "https://kiko.owner.workers.dev", accountId: "acc1", script: "kiko" }
      const world = makeWorld({
        accounts: [{ id: "acc1", subdomain: "owner", scripts: { kiko: ownedBy("user_a") } }],
        users: { user_a: { email: "ann@example.com", metadata: { kiko: pointer, theme: "dark" } } },
      })
      const reply = yield* (yield* installerFor(world)).detach("user_a")
      assert.deepStrictEqual(reply, { status: 204, body: null })
      assert.deepStrictEqual(world.users.get("user_a")?.metadata, { theme: "dark" })
      assert.deepStrictEqual(world.writes, [])
    }),
  )

  it.effect("uploads the app builder before the backend and binds the backend to it", () =>
    Effect.gen(function* () {
      const world = makeWorld({ accounts: [{ id: "acc1", subdomain: "owner", scripts: {} }] })
      const installer = yield* installerFor(world, true)
      const reply = yield* installer.install({ sub: "user_a", grant: TOKEN_GRANT })
      assert.strictEqual(reply.status, 200)
      assert.deepStrictEqual(
        world.uploads.map((upload) => [upload.script, shape(upload.bindings)]),
        [
          ["kiko-builder", ["durable_object_namespace:BUILDER"]],
          [
            "kiko",
            [
              "durable_object_namespace:OWNER",
              "OWNER_ID=user_a",
              "secret_text:CF_GRANT",
              "secret_text:SESSION_SECRET",
              "secret_text:CREDENTIALS_KEK",
              "service:BUILDER=kiko-builder",
            ],
          ],
        ],
      )
    }),
  )

  it.effect("fails the install and uploads nothing when the app builder upload fails", () =>
    Effect.gen(function* () {
      const world = makeWorld({ accounts: [{ id: "acc1", subdomain: "owner", scripts: {}, refuses: "builder" }] })
      const installer = yield* installerFor(world, true)
      const reply = yield* installer.install({ sub: "user_a", grant: TOKEN_GRANT })
      assert.strictEqual(reply.status, 502)
      assert.strictEqual(reply.body.error?.code, "cloudflare_down")
      assert.deepStrictEqual(world.uploads, [])
    }),
  )
})
