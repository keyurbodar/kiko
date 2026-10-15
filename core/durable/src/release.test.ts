import { describe, expect, test } from "bun:test"
import { verifyRelease } from "./release"

const enc = new TextEncoder()
const toB64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as ArrayBuffer).toString("base64")
const toB64Url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as ArrayBuffer).toString("base64url")

async function signer() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey)
  return { privateKey: pair.privateKey, x: jwk.x as string }
}

describe("verifyRelease", () => {
  const manifest = enc.encode('{"version":"1.0.0","modules":[]}')

  test("accepts a signature made by the matching private key", async () => {
    const { privateKey, x } = await signer()
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, manifest)
    expect(await verifyRelease(manifest, toB64(sig), x)).toBe(true)
  })

  test("rejects a manifest edited after signing", async () => {
    const { privateKey, x } = await signer()
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, manifest)
    const edited = enc.encode('{"version":"9.9.9","modules":[]}')
    expect(await verifyRelease(edited, toB64(sig), x)).toBe(false)
  })

  test("rejects a signature from another key", async () => {
    const signed = await signer()
    const other = await signer()
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, signed.privateKey, manifest)
    expect(await verifyRelease(manifest, toB64(sig), other.x)).toBe(false)
  })

  test("rejects malformed signature and key text without throwing", async () => {
    const { x } = await signer()
    expect(await verifyRelease(manifest, "not base64!!", x)).toBe(false)
    expect(await verifyRelease(manifest, toB64(new Uint8Array(10)), x)).toBe(false)
    expect(await verifyRelease(manifest, toB64(new Uint8Array(64)), "short")).toBe(false)
    expect(await verifyRelease(manifest, toB64(new Uint8Array(64)), "")).toBe(false)
  })

  test("accepts an unpadded base64url public key from a JWK", async () => {
    const { privateKey, x } = await signer()
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, manifest)
    expect(toB64Url(Buffer.from(x, "base64url"))).toBe(x)
    expect(await verifyRelease(manifest, toB64(sig), x)).toBe(true)
  })
})
