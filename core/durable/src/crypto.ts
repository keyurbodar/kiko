const INFO = "kiko-cred-v1"
const IV_BYTES = 12
const utf8 = new TextEncoder()

export interface Kek {
  version: number
  secret: string
}

export interface Keyring {
  current: Kek
}

export interface KeyringEnv {
  CREDENTIALS_KEK: string
}

class CryptoError extends Error {}

export function keyringFromEnv(env: KeyringEnv): Keyring {
  if (!env.CREDENTIALS_KEK) throw new CryptoError("CREDENTIALS_KEK is not set")
  return { current: { version: 1, secret: env.CREDENTIALS_KEK } }
}

async function dataKey(kek: Kek, userId: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", utf8.encode(kek.secret), "HKDF", false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: utf8.encode(userId), info: utf8.encode(INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

function aad(userId: string, providerId: string): Uint8Array {
  return utf8.encode(`${userId}:${providerId}`)
}

export interface Sealed {
  kekVersion: number
  iv: Uint8Array
  ciphertext: Uint8Array
}

export async function seal(keyring: Keyring, userId: string, providerId: string, plaintext: string): Promise<Sealed> {
  const kek = keyring.current
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await dataKey(kek, userId)
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(userId, providerId) },
    key,
    utf8.encode(plaintext),
  )
  return { kekVersion: kek.version, iv, ciphertext: new Uint8Array(ciphertext) }
}

export async function open(keyring: Keyring, userId: string, providerId: string, sealed: Sealed): Promise<string> {
  const key = await dataKey(keyring.current, userId)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.iv, additionalData: aad(userId, providerId) },
      key,
      sealed.ciphertext,
    )
    return new TextDecoder().decode(plain)
  } catch {
    throw new CryptoError("credential did not decrypt")
  }
}
