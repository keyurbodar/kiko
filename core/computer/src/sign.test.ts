import { describe, expect, it } from "vitest"
import { connectMessage, fromBase64Url, generateKeys, sign, toBase64Url, verify } from "./sign"

describe("pairing signatures", () => {
  it("round-trips base64url", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252])
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
  })

  it("refuses a signature whose length cannot decode, instead of throwing", () => {
    expect(fromBase64Url("A")).toBeNull()
    expect(fromBase64Url("abcde")).toBeNull()
    expect(fromBase64Url("not base64!")).toBeNull()
  })

  it("verifies a signature it made and refuses a tampered message", async () => {
    const keys = await generateKeys()
    const message = connectMessage("owner", "pc1", 1_700_000_000_000, 1)
    const signature = await sign(keys.privateKey, message)
    expect(await verify(keys.publicKey, signature, message)).toBe(true)
    expect(await verify(keys.publicKey, signature, connectMessage("owner", "pc2", 1_700_000_000_000, 1))).toBe(false)
  })
})
