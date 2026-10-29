import { assert, describe, it, vi } from "@effect/vitest"
import { PROTOCOL } from "@kiko/computer/wire"
import { type Host, runLink } from "./connection"

class SilentSocket {
  static made: SilentSocket[] = []
  closed: { code: number; reason: string } | null = null
  constructor(readonly url: string) {
    SilentSocket.made.push(this)
  }
  addEventListener() {}
  send() {}
  close(code: number, reason: string) {
    this.closed = { code, reason }
  }
}

async function host(): Promise<Host> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
  return {
    endpoint: { url: "https://kiko.example", userId: "owner", pcId: "pc-1", protocol: PROTOCOL },
    key: await crypto.subtle.exportKey("jwk", pair.privateKey),
    hello: () => "{}",
    policy: async () => ({ shell: true, files: { allow: ["~"] }, desktop: false, live: false, input: false }),
    desktop: () => null,
    live: { rtc() {}, live() {}, input() {}, control() {}, ack() {} },
    holder: () => "agent",
    log: { info() {}, warn() {}, error() {} },
  }
}

describe("daemon connect", () => {
  it("gives up on a socket that never opens", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    vi.stubGlobal("WebSocket", SilentSocket)
    try {
      const link = runLink(await host()) as unknown as { open(): Promise<number | null> }
      const opened = link.open()
      await vi.waitFor(() => assert.strictEqual(SilentSocket.made.length, 1))
      await vi.advanceTimersByTimeAsync(20_000)

      assert.isNull(await opened)
      assert.deepStrictEqual(SilentSocket.made[0]?.closed, { code: 4000, reason: "connect timed out" })
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
      SilentSocket.made = []
    }
  })
})
