import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/models"
import { describe, expect, it } from "vitest"
import { cleanBaseUrl, customId, customProvider, fetchUpstream, parseModels } from "./custom"

const answer = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe("custom providers", () => {
  it("names a provider by a stable id", () => {
    expect(customId("My LiteLLM!")).toBe("custom-my-litellm")
  })

  it("keeps the OpenAI path and drops a trailing /v1 for Anthropic", () => {
    expect(cleanBaseUrl("openai-completions", "https://host.example/v1/")).toBe("https://host.example/v1")
    expect(cleanBaseUrl("anthropic-messages", "https://host.example/v1")).toBe("https://host.example")
    expect(cleanBaseUrl("openai-completions", "http://host.example/v1")).toBeNull()
  })

  it("reads OpenAI and Anthropic model lists", () => {
    expect(parseModels({ data: [{ id: "b" }, { id: "a", display_name: "Model A" }, { id: "b" }] })).toEqual([
      { id: "a", name: "Model A" },
      { id: "b", name: "b" },
    ])
    expect(parseModels({ error: "nope" })).toEqual([])
  })

  it("lists models from the endpoint with the key, and reports a refused key", async () => {
    const seen: [string, Headers][] = []
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push([url, new Headers(init.headers)])
      return new Response(JSON.stringify({ data: [{ id: "claude-opus-4-5" }] }))
    }) as unknown as typeof fetch
    const got = await fetchUpstream({ api: "anthropic-messages", baseUrl: "https://h.example" }, "k", fetcher)
    expect(got).toEqual({ ok: true, models: [{ id: "claude-opus-4-5", name: "claude-opus-4-5" }] })
    expect(seen[0]?.[0]).toBe("https://h.example/v1/models?limit=1000")
    expect(seen[0]?.[1].get("x-api-key")).toBe("k")
    expect(await fetchUpstream({ api: "openai-completions", baseUrl: "https://h" }, "k", answer(401, {}))).toEqual({
      ok: false,
      reason: "refused",
    })
  })

  it("bounds the model list fetch with an abort signal", async () => {
    let signal: AbortSignal | undefined
    const fetcher = (async (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined
      return new Response(JSON.stringify({ data: [] }))
    }) as unknown as typeof fetch
    await fetchUpstream({ api: "openai-completions", baseUrl: "https://h.example" }, "k", fetcher)
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  it("gives a model pi knows its reasoning levels and context, and a stranger safe defaults", () => {
    const provider = customProvider({
      id: "custom-gw",
      name: "Gateway",
      api: "anthropic-messages",
      baseUrl: "https://h.example",
      models: [
        { id: "claude-opus-4-5", name: "claude-opus-4-5" },
        { id: "house-model", name: "House" },
      ],
    })
    const [opus, house] = provider.getModels()
    expect(opus?.name).toBe("Claude Opus 4.5")
    expect(opus?.contextWindow).toBe(200_000)
    expect(getSupportedThinkingLevels(opus!)).toContain("medium")
    expect(house).toMatchObject({
      name: "House",
      reasoning: false,
      baseUrl: "https://h.example",
      provider: "custom-gw",
    })
    expect(getSupportedThinkingLevels(house!)).toEqual(["off"])
  })
})
