import { Schema } from "effect"
import { Hello, PROTOCOL } from "@kiko/computer/wire"
import { CONNECT_HEADERS } from "@kiko/computer/sign"
import type { Env } from "../index"
import { NameError, ownerStub } from "../lib/names"
import { error } from "../lib/route"
import { readPairCode } from "./pairing"

const PAIR_PATH = "/api/pc/pair"
const CONNECT_PATH = "/api/pc/connect"

const MAX_BODY = 8_192
const NAME_MAX = 60
const KEY_MAX = 128
const ID_MAX = 64

const decodeHello = Schema.decodeUnknownSync(Hello)

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
  const text = await request.text()
  if (text.length > MAX_BODY) return error(413, "body is too large")
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
    return out.ok ? Response.json({ id: out.id, name: out.name, userId: read.userId }) : error(409, out.error)
  } catch (e) {
    if (e instanceof NameError) return error(403, "that pairing code is not valid or has expired")
    throw e
  }
}

function connect(request: Request, env: Env): Promise<Response> | Response {
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
  try {
    return ownerStub(env.OWNER, user).fetch(request)
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
