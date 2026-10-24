import { describe, expect, it } from "vitest"
import { openPairing } from "./pairing"

const PAIR = { code: "c", url: "https://kiko.example/pc#c", expiresAt: 1_000 }
const saved = (known: readonly string[]) => JSON.stringify({ ...PAIR, known })

describe("openPairing", () => {
  it("brings back a code the owner left open", () => {
    expect(openPairing(saved(["a"]), ["a"])).toEqual(PAIR)
  })

  it("keeps an expired code so the owner can ask for a new one", () => {
    expect(openPairing(saved([]), [])).toEqual(PAIR)
  })

  it("closes the code once a computer paired while the owner was away", () => {
    expect(openPairing(saved(["a"]), ["a", "b"])).toBeNull()
  })

  it("ignores nothing saved or a damaged value", () => {
    expect(openPairing(null, [])).toBeNull()
    expect(openPairing("{", [])).toBeNull()
    expect(openPairing(JSON.stringify({ code: 1 }), [])).toBeNull()
  })
})
