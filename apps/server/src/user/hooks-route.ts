import { PRODUCTION_OWNER } from "../auth/auth"
import type { Env } from "../index"
import { ownerStub } from "../lib/names"
import { readCapped } from "../lib/read-capped"
import { sha256Hex } from "@kiko/durable/hash"

const PATH = /^\/api\/hooks\/([0-9a-f]{48})$/
const MAX_HOOK_BYTES = 64 * 1024
const MAX_RUNS_PER_HOUR = 60
const HOUR_MS = 3_600_000
const MAX_TRACKED_HOOKS = 1024
const RETRY_WINDOW_MS = 60_000
const SIGNED = /^sha256=([0-9a-f]{64})$/i
const DELIVERY_HEADERS = ["x-github-delivery", "idempotency-key", "x-request-id"] as const
const encoder = new TextEncoder()

type Window = { start: number; count: number }

const windows = new Map<string, Window>()

const answer = (status: number, body: Record<string, unknown>) => Response.json(body, { status })

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
}

async function signatureMatches(token: string, body: string, header: string | null): Promise<boolean> {
  const hex = header ? SIGNED.exec(header)?.[1] : undefined
  if (!hex) return false
  const key = await crypto.subtle.importKey("raw", encoder.encode(token), { name: "HMAC", hash: "SHA-256" }, false, [
    "verify",
  ])
  return crypto.subtle.verify("HMAC", key, fromHex(hex), encoder.encode(body))
}

function offeredDelivery(request: Request): string | null {
  for (const name of DELIVERY_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) return value
  }
  return null
}

async function deliveryKey(request: Request, token: string, body: string): Promise<{ key: string; signed: boolean }> {
  const offered = offeredDelivery(request)
  if (offered !== null && (await signatureMatches(token, body, request.headers.get("x-hub-signature-256"))))
    return { key: offered, signed: true }
  const hash = (await sha256Hex(body)).slice(0, 32)
  return { key: `${hash}:${Math.floor(Date.now() / RETRY_WINDOW_MS)}`, signed: false }
}

function withinBudget(token: string, now: number): boolean {
  const current = windows.get(token)
  if (!current || now - current.start >= HOUR_MS) {
    if (!current && windows.size >= MAX_TRACKED_HOOKS) {
      const oldest = windows.keys().next()
      if (!oldest.done) windows.delete(oldest.value)
    }
    windows.set(token, { start: now, count: 1 })
    return true
  }
  if (current.count >= MAX_RUNS_PER_HOUR) return false
  current.count += 1
  return true
}

export async function hooksRoute(request: Request, env: Env): Promise<Response | null> {
  const token = PATH.exec(new URL(request.url).pathname)?.[1]
  if (!token) return null
  if (request.method !== "POST") return answer(405, { error: "method not allowed" })
  if (Number(request.headers.get("content-length") ?? 0) > MAX_HOOK_BYTES)
    return answer(413, { error: "the body is larger than 64 kb" })
  const body = await readCapped(request, MAX_HOOK_BYTES)
  if (body === null) return answer(413, { error: "the body is larger than 64 kb" })
  const delivery = await deliveryKey(request, token, body)
  if (delivery.signed && !withinBudget(token, Date.now())) return answer(429, { error: "too many runs from this hook" })
  const status = await ownerStub(env.OWNER, PRODUCTION_OWNER).userCall("routineHook", [
    token,
    delivery.key.slice(0, 128),
    body,
  ])
  return status === "unknown" ? answer(404, { error: "no such hook" }) : answer(202, { status })
}
