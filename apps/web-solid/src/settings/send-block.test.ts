import { describe, expect, test } from "bun:test"
import { sendBlock } from "./send-block"

const kiko = "Kiko"
const go = { provider: "opencode-go" }
const known = { known: true, agent: kiko }

describe("sendBlock", () => {
  test("a connected provider and a model it serves is free to send", () => {
    expect(sendBlock({ ...known, providers: [go], model: "opencode-go/kimi-k2" })).toBeNull()
  })

  test("no provider connected: say so and offer settings", () => {
    expect(sendBlock({ ...known, providers: [], model: "opencode-go/kimi-k2" })).toEqual({ reason: "Connect a model provider to chat.", actions: ["open_settings"] })
  })

  test("a key that only judges memory runs no agent, so it does not count as connected", () => {
    expect(sendBlock({ ...known, providers: [{ provider: "typesafe", chat: false }], model: "typesafe/x" })?.reason).toBe("Connect a model provider to chat.")
  })

  test("no model chosen for the agent: ask for one", () => {
    expect(sendBlock({ ...known, providers: [go], model: undefined })).toEqual({ reason: "Choose a model for Kiko.", actions: ["choose_model"] })
  })

  test("a model whose provider is not connected: choose another or connect it", () => {
    expect(sendBlock({ ...known, providers: [{ provider: "anthropic" }], model: "opencode-go/kimi-k2" })).toEqual({
      reason: "Kiko's model needs a provider you have not connected.",
      actions: ["choose_model", "open_settings"],
    })
  })

  test("a provider that turned the key down: check the key or choose another", () => {
    expect(sendBlock({ ...known, providers: [{ provider: "opencode-go", problem: "key_refused" as const }], model: "opencode-go/kimi-k2" })).toEqual({
      reason: "Kiko's provider did not accept your key.",
      actions: ["open_settings", "choose_model"],
    })
  })

  test("nothing blocks before the providers and the model have loaded, or with no agent to answer", () => {
    expect(sendBlock({ known: false, agent: kiko, providers: [], model: undefined })).toBeNull()
    expect(sendBlock({ known: true, agent: undefined, providers: [], model: undefined })).toBeNull()
  })
})
