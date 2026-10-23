export const CONNECT_HEADERS = {
  user: "x-kiko-pc-user",
  id: "x-kiko-pc-id",
  ts: "x-kiko-pc-ts",
  sig: "x-kiko-pc-sig",
  protocol: "x-kiko-pc-protocol",
} as const

export const CONNECT_SKEW_MS = 60_000

const ED25519 = { name: "Ed25519" } as const

export function connectMessage(userId: string, pcId: string, ts: number, protocol: number): Uint8Array {
  return new TextEncoder().encode(`kiko-pc-connect\n${userId}\n${pcId}\n${ts}\n${protocol}`)
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

export async function generateKeys(): Promise<{ publicKey: string; privateKey: JsonWebKey }> {
  const pair = (await crypto.subtle.generateKey(ED25519, true, ["sign", "verify"])) as CryptoKeyPair
  const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer
  return {
    publicKey: toBase64Url(new Uint8Array(raw)),
    privateKey: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey,
  }
}

export async function sign(privateKey: JsonWebKey, message: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", privateKey, ED25519, false, ["sign"])
  return toBase64Url(new Uint8Array(await crypto.subtle.sign(ED25519, key, message)))
}

export async function verify(publicKey: string, signature: string, message: Uint8Array): Promise<boolean> {
  const raw = fromBase64Url(publicKey)
  const sig = fromBase64Url(signature)
  if (!raw || raw.byteLength !== 32 || !sig || sig.byteLength !== 64) return false
  const key = await crypto.subtle.importKey("raw", raw, ED25519, false, ["verify"])
  return crypto.subtle.verify(ED25519, key, sig, message)
}
