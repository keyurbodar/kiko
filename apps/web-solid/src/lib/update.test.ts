import { describe, expect, it } from "vitest"
import { autoUpdateKey, restartStep } from "./update"

const rpcBuild = (version: string) => ({ version, protocol: 3, rpc: true })

describe("restartStep", () => {
  it("waits while the backend still reports the old version", () => {
    expect(restartStep("0.8.0", { version: "0.7.8", protocol: 3 }, "blocked")).toBe("wait")
    expect(restartStep("0.8.0", rpcBuild("0.7.9"), "backoff")).toBe("wait")
    expect(restartStep("0.8.0", null, "backoff")).toBe("wait")
  })

  it("forces a reconnect once the new backend answers but the socket sits in backoff", () => {
    expect(restartStep("0.8.0", rpcBuild("0.8.0"), "backoff")).toBe("reconnect")
    expect(restartStep("0.8.0", rpcBuild("0.8.0"), "blocked")).toBe("reconnect")
  })

  it("leaves an attempt in flight alone", () => {
    expect(restartStep("0.8.0", rpcBuild("0.8.0"), "connecting")).toBe("wait")
  })

  it("finishes when the socket is connected to the new backend", () => {
    expect(restartStep("0.8.0", rpcBuild("0.8.1"), "connected")).toBe("done")
  })
})

describe("autoUpdateKey", () => {
  const client = { version: "0.8.0", protocol: 3 }

  it("updates a backend that is behind on the same protocol, including one that predates the socket", () => {
    expect(autoUpdateKey(client, { version: "0.7.8", protocol: 3 })).toBe("0.7.8->0.8.0")
    expect(autoUpdateKey(client, rpcBuild("0.7.9"))).toBe("0.7.9->0.8.0")
  })

  it("never updates on its own across a protocol change, which starts fresh", () => {
    expect(autoUpdateKey(client, { version: "0.4.16", protocol: 1 })).toBeNull()
  })

  it("does nothing when the backend is current or unknown", () => {
    expect(autoUpdateKey(client, rpcBuild("0.8.0"))).toBeNull()
    expect(autoUpdateKey(client, null)).toBeNull()
    expect(autoUpdateKey(client, { protocol: 3 })).toBeNull()
  })
})
