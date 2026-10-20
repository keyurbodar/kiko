import { sha256Hex } from "./hash"

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

type ReleaseModule = { name: string; type: string; sha256: string }
export type ReleaseMigration = { tag: string; new_sqlite_classes?: string[]; deleted_classes?: string[] }
export type ReleaseManifest = {
  version: string
  protocol: number
  main_module: string
  compatibility_date: string
  compatibility_flags: string[]
  durable_objects?: { name: string; class_name: string }[]
  migrations: ReleaseMigration[]
  modules: ReleaseModule[]
}

export function parseManifest(manifestBytes: Uint8Array): ReleaseManifest | null {
  try {
    const m = JSON.parse(new TextDecoder().decode(manifestBytes)) as Partial<ReleaseManifest>
    const ok =
      typeof m.version === "string" &&
      typeof m.protocol === "number" &&
      (m.durable_objects === undefined || Array.isArray(m.durable_objects) && m.durable_objects.length > 0 && m.durable_objects.every((binding) => binding && typeof binding.name === "string" && typeof binding.class_name === "string")) &&
      typeof m.main_module === "string" &&
      typeof m.compatibility_date === "string" &&
      Array.isArray(m.compatibility_flags) &&
      Array.isArray(m.migrations) &&
      Array.isArray(m.modules) &&
      m.modules.every((x) => x && typeof x.name === "string" && typeof x.type === "string" && typeof x.sha256 === "string") &&
      m.modules.some((x) => x.name === m.main_module)
    return ok ? (m as ReleaseManifest) : null
  } catch {
    return null
  }
}

export async function verifyModuleHash(module: ReleaseModule, bytes: Uint8Array): Promise<boolean> {
  return (await sha256Hex(bytes)) === module.sha256.toLowerCase()
}
