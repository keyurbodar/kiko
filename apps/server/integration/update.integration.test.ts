import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { createHash } from "node:crypto"
import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { signIn } from "./owner"
import { localWorker } from "./worker"

const VERSION = "9.9.9"

type Upload = { bindings: unknown[]; migrations: unknown }

const release = Effect.promise(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
  const publicKey = ((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey).x as string
  const module = Buffer.from("export default { fetch() { return new Response('next') } }")
  const manifest = Buffer.from(
    JSON.stringify({
      version: VERSION,
      protocol: 3,
      main_module: "index.js",
      compatibility_date: "2026-09-01",
      compatibility_flags: ["nodejs_compat"],
      durable_objects: [{ name: "OWNER", class_name: "OwnerDO" }],
      migrations: [{ tag: "v5", new_sqlite_classes: ["OwnerDO"] }],
      modules: [
        {
          name: "index.js",
          type: "application/javascript+module",
          sha256: createHash("sha256").update(module).digest("hex"),
        },
      ],
    }),
  )
  const signature = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, manifest))
  const files = new Map<string, Buffer>([
    [`/releases/${VERSION}/manifest.json`, manifest],
    [`/releases/${VERSION}/manifest.sig`, Buffer.from(signature.toString("base64"))],
    [`/releases/${VERSION}/index.js`, module],
  ])
  return { publicKey, files }
})

const SETTINGS = [
  { type: "durable_object_namespace", name: "OWNER", class_name: "OwnerDO" },
  { type: "plain_text", name: "OWNER_ID", text: "user_a" },
  { type: "secret_text", name: "SESSION_SECRET" },
  { type: "secret_text", name: "CREDENTIALS_KEK" },
  { type: "secret_text", name: "CF_GRANT" },
  { type: "secret_text", name: "CLERK_JWT_KEY" },
]

const body = (request: IncomingMessage) =>
  new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))))
    request.on("error", reject)
  })

const send = (response: ServerResponse, status: number, payload: unknown) => {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(payload))
}

const fakeCloudflare = Effect.gen(function* () {
  const signed = yield* release
  const uploads: Upload[] = []
  const refreshTokens: string[] = []
  const uploaded = Promise.withResolvers<void>()
  const answer = async (request: IncomingMessage, response: ServerResponse) => {
    const path = new URL(request.url ?? "/", "http://fake").pathname
    const file = signed.files.get(path)
    if (file) return response.end(file)
    if (path === "/oauth/token") {
      refreshTokens.push(
        String(new URLSearchParams(new TextDecoder().decode(await body(request))).get("refresh_token")),
      )
      return send(response, 200, { access_token: "access", refresh_token: "rotated" })
    }
    if (path === "/cf/accounts/acc/workers/scripts")
      return send(response, 200, { success: true, result: [{ id: "kiko", migration_tag: "v5" }] })
    if (path === "/cf/accounts/acc/workers/scripts/kiko/settings")
      return send(response, 200, { success: true, result: { bindings: SETTINGS } })
    if (path === "/cf/accounts/acc/workers/scripts/kiko" && request.method === "PUT") {
      const form = await new Response(await body(request), {
        headers: { "content-type": String(request.headers["content-type"]) },
      }).formData()
      const metadata = JSON.parse(await (form.get("metadata") as Blob).text()) as Upload
      uploads.push({ bindings: metadata.bindings, migrations: metadata.migrations })
      send(response, 200, { success: true, result: {} })
      return uploaded.resolve()
    }
    send(response, 404, { success: false, errors: [{ code: 10007, message: "not found" }] })
  }
  const server = yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<ReturnType<typeof createServer>>((resolve) => {
          const listening = createServer((request, response) => void answer(request, response))
          listening.listen(0, "127.0.0.1", () => resolve(listening))
        }),
    ),
    (listening) => Effect.promise(() => new Promise<void>((resolve) => listening.close(() => resolve()))),
  )
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url, publicKey: signed.publicKey, uploads, refreshTokens, uploaded: uploaded.promise }
})

describe("/api/update", () => {
  it.live("uploads a signed release through the Cloudflare grant and reports the restart", () =>
    Effect.gen(function* () {
      const cloudflare = yield* fakeCloudflare
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "owner")
      yield* owner.post("api/dev/user/update-config", {
        releaseBase: `${cloudflare.url}/releases`,
        publicKey: cloudflare.publicKey,
        cfApi: `${cloudflare.url}/cf`,
        oauthUrl: `${cloudflare.url}/oauth/token`,
        grant: JSON.stringify({
          kind: "oauth",
          accountId: "acc",
          scriptName: "kiko",
          clientId: "client",
          refreshToken: "first",
        }),
      })
      const state = () =>
        fetch(new URL("api/update", worker.url), { headers: { authorization: `Bearer ${owner.token}` } }).then(
          (response) => response.json() as Promise<unknown>,
        )
      assert.deepStrictEqual(yield* Effect.promise(state), { stage: "idle" })
      assert.deepStrictEqual(yield* owner.post("api/update", { version: VERSION }), {
        stage: "uploading",
        to: VERSION,
      })
      yield* Effect.promise(() => cloudflare.uploaded)
      yield* Effect.promise(() => expect.poll(state).toEqual({ stage: "restarting", to: VERSION }))
      assert.deepStrictEqual(yield* owner.post("api/update", { version: VERSION }), {
        stage: "restarting",
        to: VERSION,
      })
      assert.deepStrictEqual(cloudflare.refreshTokens, ["first"])
      assert.deepStrictEqual(cloudflare.uploads, [
        {
          bindings: [
            { type: "durable_object_namespace", name: "OWNER", class_name: "OwnerDO" },
            { type: "inherit", name: "OWNER_ID" },
            { type: "inherit", name: "SESSION_SECRET" },
            { type: "inherit", name: "CREDENTIALS_KEK" },
            { type: "inherit", name: "CF_GRANT" },
          ],
          migrations: { old_tag: "v5", new_tag: "v5", steps: [] },
        },
      ])
    }).pipe(Effect.scoped),
  )
})
