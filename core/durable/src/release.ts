// Ed25519 release signatures. The owner signs manifest.json with a private key that never leaves the
// machine that built the release. The installer and the update path check the signature with the
// public key `x` (base64url, the JWK form) before they trust any module the manifest names.

const ALGORITHM = { name: "Ed25519" } as const

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=")
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

function fromBase64(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null
  try {
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

// Returns true only when `sigB64` is a valid Ed25519 signature of `manifestBytes` under `publicKeyX`.
// Any malformed input returns false; it never throws, so a caller cannot mistake an error for a pass.
export async function verifyRelease(manifestBytes: Uint8Array, sigB64: string, publicKeyX: string): Promise<boolean> {
  const signature = fromBase64(sigB64.trim())
  const rawKey = fromBase64Url(publicKeyX.trim())
  if (!signature || !rawKey || rawKey.length !== 32 || signature.length !== 64) return false
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: publicKeyX.trim(), key_ops: ["verify"], ext: true },
      ALGORITHM,
      false,
      ["verify"],
    )
    return await crypto.subtle.verify(ALGORITHM, key, signature, manifestBytes)
  } catch {
    return false
  }
}
