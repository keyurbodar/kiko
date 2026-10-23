import { fromBase64Url, toBase64Url } from "@kiko/computer/sign"

const PAIR_TTL_MS = 10 * 60_000

const encoder = new TextEncoder()
const KEY_SALT = "kiko-pc-pair"
const KEY_INFO = "kiko-pc-pair-v1"
const NONCE_BYTES = 16

async function pairKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(KEY_SALT), info: encoder.encode(KEY_INFO) },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  )
}

function message(userId: string, expiry: number, nonce: string): Uint8Array {
  return encoder.encode(`pc-pair|${userId}|${expiry}|${nonce}`)
}

function randomNonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)))
}

export type PairCode = { code: string; expiresAt: number; nonce: string }

export async function mintPairCode(secret: string, userId: string, now = Date.now()): Promise<PairCode> {
  const expiresAt = now + PAIR_TTL_MS
  const nonce = randomNonce()
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await pairKey(secret), message(userId, expiresAt, nonce)))
  return { code: `${userId}.${expiresAt}.${nonce}.${toBase64Url(mac)}`, expiresAt, nonce }
}

export type PairCodeRead = { userId: string; expiresAt: number; nonce: string }

export async function readPairCode(secret: string, code: string, now = Date.now()): Promise<PairCodeRead | null> {
  const parts = code.split(".")
  if (parts.length !== 4) return null
  const [userId = "", expiryText = "", nonce = "", mac = ""] = parts
  if (!userId || !nonce) return null
  const expiresAt = Number(expiryText)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null
  const signature = fromBase64Url(mac)
  if (!signature || signature.byteLength !== 32) return null
  const valid = await crypto.subtle.verify("HMAC", await pairKey(secret), signature, message(userId, expiresAt, nonce))
  return valid ? { userId, expiresAt, nonce } : null
}
