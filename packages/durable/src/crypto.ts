// Architecture section 11.2. Envelope encryption for secrets a user stores with kiko.
//
//   data key = HKDF-SHA256(KEK, salt = userId, info = "kiko-cred-v1")
//   record   = AES-256-GCM(data key, iv = 12 random bytes, aad = userId || providerId)
//
// Every record carries the KEK version that sealed it, so the secret can rotate. This
// module never logs and never puts a plaintext or a key into an error message.

const INFO = "kiko-cred-v1"
const IV_BYTES = 12
const utf8 = new TextEncoder()

/** One KEK secret and the version number stored next to every record it seals. */
export interface Kek {
  version: number
  secret: string
}

/**
 * The current KEK and, during a rotation, the one before it. New records are sealed with
 * `current`. A record sealed with `previous` still opens until it is re-sealed.
 */
export interface Keyring {
  current: Kek
  previous?: Kek
}

export interface KeyringEnv {
  CREDENTIALS_KEK: string
  /** The version of `CREDENTIALS_KEK`. Defaults to 1. */
  CREDENTIALS_KEK_VERSION?: string
  /** The secret before `CREDENTIALS_KEK`, at version - 1. Set only during a rotation. */
  CREDENTIALS_KEK_PREVIOUS?: string
}

export class CryptoError extends Error {}

/**
 * Reads the keyring from Worker secrets. To rotate: move the old secret to
 * `CREDENTIALS_KEK_PREVIOUS`, set a new `CREDENTIALS_KEK`, and add 1 to
 * `CREDENTIALS_KEK_VERSION`. Records re-seal with the new secret when next read.
 */
export function keyringFromEnv(env: KeyringEnv): Keyring {
  if (!env.CREDENTIALS_KEK) throw new CryptoError("CREDENTIALS_KEK is not set")
  const version = env.CREDENTIALS_KEK_VERSION ? Number(env.CREDENTIALS_KEK_VERSION) : 1
  if (!Number.isInteger(version) || version < 1) throw new CryptoError("CREDENTIALS_KEK_VERSION must be a positive integer")
  const current = { version, secret: env.CREDENTIALS_KEK }
  const previous = env.CREDENTIALS_KEK_PREVIOUS ? { version: version - 1, secret: env.CREDENTIALS_KEK_PREVIOUS } : undefined
  return previous ? { current, previous } : { current }
}

function kekFor(keyring: Keyring, version: number): Kek {
  if (keyring.current.version === version) return keyring.current
  if (keyring.previous?.version === version) return keyring.previous
  throw new CryptoError(`no secret for kek version ${version}`)
}

/** The per-user AES-256-GCM key. Only this module ever holds it. */
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

// ASSUMPTION: `userId || providerId` is joined with ":". A user id cannot contain ":"
// (lib/names.ts), so no two pairs give the same bytes, which bare concatenation allows.
function aad(userId: string, providerId: string): Uint8Array {
  return utf8.encode(`${userId}:${providerId}`)
}

export interface Sealed {
  kekVersion: number
  iv: Uint8Array
  ciphertext: Uint8Array
}

/** Encrypts `plaintext` for one user and one provider with the current KEK. */
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

/**
 * Decrypts a record. Throws `CryptoError` when the KEK version is unknown, or when the
 * user, the provider, or the bytes do not match what was sealed.
 */
export async function open(keyring: Keyring, userId: string, providerId: string, sealed: Sealed): Promise<string> {
  const key = await dataKey(kekFor(keyring, sealed.kekVersion), userId)
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
