import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"
import { ModelClient, ModelError } from "./model"

interface Seen {
  readonly body: unknown
  readonly headers: Record<string, string | string[] | undefined>
}

interface Fake {
  readonly url: string
  readonly seen: Seen[]
  close(): Promise<void>
}

async function fakeServer(reply: (seen: Seen, index: number) => { status: number; body: unknown }): Promise<Fake> {
  const seen: Seen[] = []
  const server = createServer(async (req, res) => {
    let text = ""
    for await (const chunk of req) text += String(chunk)
    const entry: Seen = { body: JSON.parse(text) as unknown, headers: req.headers }
    seen.push(entry)
    const answer = reply(entry, seen.length - 1)
    res.writeHead(answer.status, { "content-type": "application/json" })
    res.end(JSON.stringify(answer.body))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}/chat/completions`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

const answer = {
  id: "chatcmpl-test",
  choices: [
    {
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        reasoning_content: "I should look first.",
        tool_calls: [{ id: "call-1", type: "function", function: { name: "shell", arguments: '{"command":"ls"}' } }],
      },
    },
  ],
  usage: {
    prompt_tokens: 94,
    completion_tokens: 42,
    completion_tokens_details: { reasoning_tokens: 28 },
    cost: 0.001,
    opencode: { list_cost: 0.002, tokens: { cache_read: 11, reasoning: 28 } },
  },
}

describe("model client", () => {
  it("sends the bench headers and parses a tool call with usage", async () => {
    const fake = await fakeServer(() => ({ status: 200, body: answer }))
    try {
      const client = new ModelClient({
        key: "test-key",
        baseUrl: fake.url.replace("/chat/completions", ""),
        version: "9.9.9",
      })
      const reply = await client.chat({
        model: "beam-free",
        messages: [{ role: "user", content: "list the files" }],
        tools: [{ name: "shell", description: "run a command", parameters: { type: "object" } }],
        session: "kb-run-1-trial-1",
      })
      expect(reply.content).toBe("")
      expect(reply.reasoning).toBe("I should look first.")
      expect(reply.finishReason).toBe("tool_calls")
      expect(reply.toolCalls).toEqual([
        { id: "call-1", type: "function", function: { name: "shell", arguments: '{"command":"ls"}' } },
      ])
      expect(reply.usage).toEqual({
        prompt: 94,
        cached: 11,
        completion: 42,
        reasoning: 28,
        cost: 0.001,
        listCost: 0.002,
      })
      const request = fake.seen[0]
      expect(request?.headers["user-agent"]).toBe("kiko-bench/9.9.9")
      expect(request?.headers["x-opencode-session"]).toBe("kb-run-1-trial-1")
      expect(request?.headers.authorization).toBe("Bearer test-key")
      const body = request?.body as { model?: string; tool_choice?: string; tools?: unknown[] }
      expect(body.model).toBe("beam-free")
      expect(body.tool_choice).toBe("auto")
      expect(body.tools).toHaveLength(1)
    } finally {
      await fake.close()
    }
  })

  it("reads a plain text answer with no tools", async () => {
    const fake = await fakeServer(() => ({
      status: 200,
      body: {
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "DONE" } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      },
    }))
    try {
      const client = new ModelClient({ key: "k", baseUrl: fake.url.replace("/chat/completions", ""), version: "0" })
      const reply = await client.chat({ model: "beam-free", messages: [], tools: [], session: "kb-a-b" })
      expect(reply.content).toBe("DONE")
      expect(reply.toolCalls).toEqual([])
      expect(reply.usage.cost).toBe(0)
    } finally {
      await fake.close()
    }
  })

  it("does not retry a failed call", async () => {
    const fake = await fakeServer(() => ({ status: 500, body: { error: "upstream" } }))
    try {
      const client = new ModelClient({ key: "k", baseUrl: fake.url.replace("/chat/completions", ""), version: "0" })
      await expect(
        client.chat({ model: "beam-free", messages: [], tools: [], session: "kb-a-b" }),
      ).rejects.toBeInstanceOf(ModelError)
      expect(fake.seen).toHaveLength(1)
    } finally {
      await fake.close()
    }
  })

  it("rejects a body that is not JSON", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" })
      res.end("not json")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address() as AddressInfo
    try {
      const client = new ModelClient({ key: "k", baseUrl: `http://127.0.0.1:${address.port}`, version: "0" })
      await expect(
        client.chat({ model: "beam-free", messages: [], tools: [], session: "kb-a-b" }),
      ).rejects.toBeInstanceOf(ModelError)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
