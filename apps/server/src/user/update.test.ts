import { assert, describe, it } from "@effect/vitest"
import { sha256Hex } from "@kiko/durable/hash"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { type GrantCell, grantStore, runUpdate, type UpdateConfig } from "./update"

const VERSION = "9.9.9"
const KEYRING = { current: { version: 1, secret: "kek" } }

type Seen = { refreshTokens: string[]; uploads: { bindings: unknown[]; migrations: unknown; keep?: unknown }[] }

const signedRelease = Effect.promise(async () => {
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
    }),
  )
  const signature = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, manifest))
  return {
    publicKey,
    files: { "manifest.json": manifest, "manifest.sig": signature.toString("base64"), "index.js": module },
  }
})

const ok = (result: unknown) => Response.json({ success: true, result })

function fakeCloudflare(release: Effect.Success<typeof signedRelease>, seen: Seen, oauth: "accepts" | "refuses") {
  const config: UpdateConfig = {
    releaseBase: "https://releases.test",
    publicKey: release.publicKey,
    cfApi: "https://cf.test",
    oauthUrl: "https://dash.test/token",
  }
  const fetch = async (url: string, init: RequestInit = {}) => {
    const { host, pathname } = new URL(url)
    if (host === "releases.test") {
      const file = release.files[pathname.split("/").pop() as keyof typeof release.files]
      return file ? new Response(file) : new Response("missing", { status: 404 })
    }
    if (host === "dash.test") {
      seen.refreshTokens.push(String(new URLSearchParams(init.body as URLSearchParams).get("refresh_token")))
      if (oauth === "refuses") return Response.json({ error: "invalid_grant" }, { status: 400 })
      return Response.json({ access_token: "access", refresh_token: `rotated-${seen.refreshTokens.length}` })
    }
    if (pathname === "/accounts/acc/workers/scripts") return ok([{ id: "kiko", migration_tag: "v5" }])
    if (pathname === "/accounts/acc/workers/scripts/kiko/settings")
      return ok({
        bindings: [
          { type: "durable_object_namespace", name: "OWNER", class_name: "OwnerDO" },
          { type: "plain_text", name: "OWNER_ID", text: "user_a" },
          { type: "secret_text", name: "SESSION_SECRET" },
          { type: "secret_text", name: "CREDENTIALS_KEK" },
          { type: "secret_text", name: "CF_GRANT" },
          { type: "secret_text", name: "CLERK_JWT_KEY" },
          { type: "secret_text", name: "TRUSTED_ORIGINS" },
          { type: "r2_bucket", name: "FILES" },
        ],
      })
    if (pathname === "/accounts/acc/workers/scripts/kiko" && init.method === "PUT") {
      const metadata = JSON.parse(await new Response((init.body as FormData).get("metadata")).text()) as {
        bindings: unknown[]
        migrations: unknown
        keep_bindings?: unknown
      }
      seen.uploads.push({ bindings: metadata.bindings, migrations: metadata.migrations, keep: metadata.keep_bindings })
      return ok({})
    }
    return Response.json({ success: false, errors: [{ code: 10007, message: "not found" }] }, { status: 404 })
  }
  return { config, fetch }
}

const grant = (refreshToken: string) =>
  JSON.stringify({ kind: "oauth", accountId: "acc", scriptName: "kiko", clientId: "client", refreshToken })

function memoryCell(): GrantCell & { writes: number } {
  let text: string | null = null
  const cell = {
    writes: 0,
    read: () => text,
    write: (next: string) => {
      text = next
      cell.writes += 1
    },
  }
  return cell
}

const update = (options: {
  env: string | undefined
  cell: GrantCell
  oauth?: "accepts" | "refuses"
  release: Effect.Success<typeof signedRelease>
  seen: Seen
}) => {
  const cloudflare = fakeCloudflare(options.release, options.seen, options.oauth ?? "accepts")
  return runUpdate(
    {
      ...cloudflare,
      grants: grantStore({ keyring: KEYRING, userId: "owner", env: options.env, cell: options.cell }),
    },
    VERSION,
  ).pipe(Effect.result, Effect.map(Result.match({ onSuccess: () => "uploaded", onFailure: (error) => error.code })))
}

describe("runUpdate", () => {
  it.effect("uses the rotated grant only while the env grant it came from is still the one bound", () =>
    Effect.gen(function* () {
      const release = yield* signedRelease
      const seen: Seen = { refreshTokens: [], uploads: [] }
      const cell = memoryCell()
      assert.strictEqual(yield* update({ env: grant("first"), cell, release, seen }), "uploaded")
      assert.strictEqual(yield* update({ env: grant("first"), cell, release, seen }), "uploaded")
      assert.strictEqual(yield* update({ env: grant("reconnected"), cell, release, seen }), "uploaded")
      assert.deepStrictEqual(seen.refreshTokens, ["first", "rotated-1", "reconnected"])
      assert.strictEqual(cell.writes, 3)
    }),
  )

  it.effect("uploads the release in one request that inherits every kept binding and drops release config", () =>
    Effect.gen(function* () {
      const release = yield* signedRelease
      const seen: Seen = { refreshTokens: [], uploads: [] }
      assert.strictEqual(yield* update({ env: grant("first"), cell: memoryCell(), release, seen }), "uploaded")
      assert.deepStrictEqual(seen.uploads, [
        {
          bindings: [
            { type: "durable_object_namespace", name: "OWNER", class_name: "OwnerDO" },
            { type: "inherit", name: "OWNER_ID" },
            { type: "inherit", name: "SESSION_SECRET" },
            { type: "inherit", name: "CREDENTIALS_KEK" },
            { type: "inherit", name: "CF_GRANT" },
            { type: "inherit", name: "FILES" },
          ],
          migrations: { old_tag: "v5", new_tag: "v5", steps: [] },
          keep: undefined,
        },
      ])
    }),
  )

  it.effect("names the failure and uploads nothing when it has no grant or Cloudflare refuses it", () =>
    Effect.gen(function* () {
      const release = yield* signedRelease
      const seen: Seen = { refreshTokens: [], uploads: [] }
      const refusedCell = memoryCell()
      assert.strictEqual(yield* update({ env: undefined, cell: memoryCell(), release, seen }), "no_grant")
      assert.strictEqual(
        yield* update({ env: grant("revoked"), cell: refusedCell, oauth: "refuses", release, seen }),
        "grant_refused",
      )
      assert.strictEqual(
        yield* update({
          env: grant("first"),
          cell: memoryCell(),
          release: { ...release, files: { ...release.files, "index.js": new TextEncoder().encode("tampered") } },
          seen,
        }),
        "release_untrusted",
      )
      assert.deepStrictEqual(seen.uploads, [])
      assert.strictEqual(refusedCell.writes, 0)
    }),
  )
})
