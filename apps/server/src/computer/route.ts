import { Schema } from "effect"
import { Hello, PROTOCOL } from "@kiko/computer/wire"
import { CONNECT_HEADERS, connectMessage, verify } from "@kiko/computer/sign"
import type { Env } from "../index"
import { edgeLimit } from "../lib/edge-limit"
import { NameError, ownerStub } from "../lib/names"
import { readCapped } from "../lib/read-capped"
import { error } from "../lib/route"
import { readPairCode } from "./pairing"

const PAIR_PATH = "/api/pc/pair"
const CONNECT_PATH = "/api/pc/connect"

const MAX_BODY = 8_192
const NAME_MAX = 60
const KEY_MAX = 128
const ID_MAX = 64
const PAIRED_TTL_S = 86_400
const REJECTED_TTL_S = 60
const WAKE_LIMIT = 60
const WAKE_WINDOW_MS = 60_000

const decodeHello = Schema.decodeUnknownSync(Hello)

function cacheKey(host: string, user: string, id: string): Request {
  return new Request(`https://${host}.cache.invalid/${encodeURIComponent(user)}/${encodeURIComponent(id)}`)
}

async function rememberPair(user: string, id: string, publicKey: string): Promise<void> {
  await caches.default
    .put(
      cacheKey("pc-paired", user, id),
      new Response(publicKey, { headers: { "cache-control": `public, max-age=${PAIRED_TTL_S}` } }),
    )
    .catch(() => {})
}

async function pairedPublicKey(user: string, id: string): Promise<string | null> {
  const hit = await caches.default.match(cacheKey("pc-paired", user, id)).catch(() => undefined)
  return hit ? hit.text() : null
}

async function forgetPair(user: string, id: string): Promise<void> {
  await caches.default.delete(cacheKey("pc-paired", user, id)).catch(() => {})
}

async function rememberRefusal(user: string, id: string, status: number): Promise<void> {
  await caches.default
    .put(
      cacheKey("pc-refused", user, id),
      new Response(String(status), { headers: { "cache-control": `public, max-age=${REJECTED_TTL_S}` } }),
    )
    .catch(() => {})
}

async function refusal(user: string, id: string): Promise<number | null> {
  const hit = await caches.default.match(cacheKey("pc-refused", user, id)).catch(() => undefined)
  if (!hit) return null
  const status = Number(await hit.text())
  return status === 410 ? 410 : 401
}

const mayWake = edgeLimit(WAKE_LIMIT, WAKE_WINDOW_MS)

type PairBody = {
  code: string
  publicKey: string
  name: string
  hello: ReturnType<typeof decodeHello>
  replaces?: string
}

function readPair(body: unknown): PairBody | null {
  if (!body || typeof body !== "object") return null
  const { code, publicKey, name, hello, replaces } = body as Record<string, unknown>
  if (typeof code !== "string" || code.length > 512) return null
  if (typeof publicKey !== "string" || publicKey.length > KEY_MAX) return null
  if (typeof name !== "string" || !name.trim() || name.trim().length > NAME_MAX) return null
  if (replaces !== undefined && (typeof replaces !== "string" || !replaces || replaces.length > ID_MAX)) return null
  try {
    return { code, publicKey, name: name.trim(), hello: decodeHello(hello), ...(replaces ? { replaces } : {}) }
  } catch {
    return null
  }
}

async function pair(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return error(405, "method not allowed")
  if (!request.headers.get("content-type")?.includes("json")) return error(400, "expected a json body")
  const text = await readCapped(request, MAX_BODY)
  if (text === null) return error(413, "body is too large")
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return error(400, "body is not json")
  }
  const input = readPair(body)
  if (!input) return error(400, "need a code, a public key, a name and a hello")
  const read = await readPairCode(env.CREDENTIALS_KEK, input.code)
  if (!read) return error(403, "that pairing code is not valid or has expired")
  try {
    const out = await ownerStub(env.OWNER, read.userId).pcPair({
      publicKey: input.publicKey,
      name: input.name,
      hello: input.hello,
      pairNonce: read.nonce,
      ...(input.replaces ? { replaces: input.replaces } : {}),
    })
    if (!out.ok) return error(409, out.error)
    await rememberPair(read.userId, out.id, input.publicKey)
    return Response.json({ id: out.id, name: out.name, userId: read.userId })
  } catch (e) {
    if (e instanceof NameError) return error(403, "that pairing code is not valid or has expired")
    throw e
  }
}

async function connect(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return error(405, "method not allowed")
  const user = request.headers.get(CONNECT_HEADERS.user)
  const id = request.headers.get(CONNECT_HEADERS.id)
  const ts = request.headers.get(CONNECT_HEADERS.ts)
  const sig = request.headers.get(CONNECT_HEADERS.sig)
  const protocol = Number(request.headers.get(CONNECT_HEADERS.protocol) ?? "")
  if (protocol !== PROTOCOL)
    return new Response("protocol mismatch", {
      status: 426,
      headers: { [CONNECT_HEADERS.protocol]: String(PROTOCOL) },
    })
  if (!user || !id || !ts || !sig) return error(401, "unauthorized")
  const publicKey = await pairedPublicKey(user, id)
  if (publicKey && !(await verify(publicKey, sig, connectMessage(user, id, Number(ts), protocol)).catch(() => false)))
    await forgetPair(user, id)
  else if (!publicKey) {
    const refused = await refusal(user, id)
    if (refused === 410) return error(410, "this computer was removed")
    if (refused === 401) return error(401, "unauthorized")
    if (!mayWake()) return error(429, "too many connection attempts")
  }
  try {
    const response = await ownerStub(env.OWNER, user).fetch(request)
    if (response.status === 401 || response.status === 410) {
      await forgetPair(user, id)
      await rememberRefusal(user, id, response.status)
    }
    return response
  } catch (e) {
    if (e instanceof NameError) return error(401, "unauthorized")
    throw e
  }
}

export async function computerRoute(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname === PAIR_PATH) return pair(request, env)
  if (pathname === CONNECT_PATH) return connect(request, env)
  return null
}
