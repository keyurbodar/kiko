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

async function streamServer(chunks: readonly unknown[], seen: Seen[] = []): Promise<Fake> {
  const server = createServer(async (req, res) => {
    let text = ""
    for await (const chunk of req) text += String(chunk)
    seen.push({ body: JSON.parse(text) as unknown, headers: req.headers })
    res.writeHead(200, { "content-type": "text/event-stream" })
    for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    res.end("data: [DONE]\n\n")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}/chat/completions`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

const streamed = [
  { choices: [{ index: 0, finish_reason: null, delta: { role: "assistant" } }], usage: null },
  { choices: [{ index: 0, finish_reason: null, delta: { content: "Hel" } }], usage: null },
  { choices: [{ index: 0, finish_reason: null, delta: { content: "lo", reasoning: "think" } }], usage: null },
  {
    choices: [
      {
        index: 0,
        finish_reason: null,
        delta: {
          tool_calls: [{ index: 0, id: "call-9", type: "function", function: { name: "shell", arguments: '{"comm' } }],
        },
      },
    ],
    usage: null,
  },
  {
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        delta: { tool_calls: [{ index: 0, function: { arguments: 'and":"ls"}' } }] },
      },
    ],
    usage: null,
  },
  { choices: [], usage: answer.usage },
]

describe("model client", () => {
  it("streams content, tool calls, usage and time to first token", async () => {
    const seen: Seen[] = []
    const fake = await streamServer(streamed, seen)
    try {
      const client = new ModelClient({
        key: "k",
        baseUrl: fake.url.replace("/chat/completions", ""),
        version: "0",
      })
      const reply = await client.chat({
        model: "beam-free",
        messages: [{ role: "user", content: "list the files" }],
        tools: [{ name: "shell", description: "run a command", parameters: { type: "object" } }],
        session: "kb-run-1-trial-1",
      })
      expect(reply.content).toBe("Hello")
      expect(reply.reasoning).toBe("think")
      expect(reply.finishReason).toBe("tool_calls")
      expect(reply.toolCalls).toEqual([
        { id: "call-9", type: "function", function: { name: "shell", arguments: '{"command":"ls"}' } },
      ])
      expect(reply.usage).toEqual({
        prompt: 94,
        cached: 11,
        completion: 42,
        reasoning: 28,
        cost: 0.001,
        listCost: 0.002,
      })
      expect(reply.ttftMs).toBeGreaterThan(0)
      expect(reply.ttftMs).toBeLessThanOrEqual(reply.latencyMs)
      const body = seen[0]?.body as { stream?: boolean; stream_options?: { include_usage?: boolean } }
      expect(body.stream).toBe(true)
      expect(body.stream_options).toEqual({ include_usage: true })
    } finally {
      await fake.close()
    }
  })

  it("keeps parallel tool calls apart when the stream leaves out the index", async () => {
    const fake = await streamServer([
      { choices: [{ index: 0, finish_reason: null, delta: { role: "assistant" } }], usage: null },
      {
        choices: [
          {
            index: 0,
            finish_reason: null,
            delta: {
              tool_calls: [{ id: "call-a", type: "function", function: { name: "read", arguments: '{"pc":' } }],
            },
          },
        ],
        usage: null,
      },
      {
        choices: [{ index: 0, finish_reason: null, delta: { tool_calls: [{ function: { arguments: '"box-1"}' } }] } }],
        usage: null,
      },
      {
        choices: [
          {
            index: 0,
            finish_reason: null,
            delta: {
              tool_calls: [{ id: "call-b", type: "function", function: { name: "read", arguments: '{"pc":"box-2"}' } }],
            },
          },
        ],
        usage: null,
      },
      { choices: [{ index: 0, finish_reason: "tool_calls", delta: {} }], usage: answer.usage },
    ])
    try {
      const client = new ModelClient({
        key: "k",
        baseUrl: fake.url.replace("/chat/completions", ""),
        version: "0",
      })
      const reply = await client.chat({
        model: "beam-free",
        messages: [{ role: "user", content: "read both boxes" }],
        tools: [{ name: "read", description: "read a file", parameters: { type: "object" } }],
        session: "kb-run-1-trial-2",
      })
      expect(reply.toolCalls).toEqual([
        { id: "call-a", type: "function", function: { name: "read", arguments: '{"pc":"box-1"}' } },
        { id: "call-b", type: "function", function: { name: "read", arguments: '{"pc":"box-2"}' } },
      ])
    } finally {
      await fake.close()
    }
  })

  it("leaves streaming out when it is turned off", async () => {
    const seen: Seen[] = []
    const fake = await fakeServer((entry) => {
      seen.push(entry)
      return { status: 200, body: answer }
    })
    try {
      const client = new ModelClient({
        key: "k",
        baseUrl: fake.url.replace("/chat/completions", ""),
        version: "0",
        streaming: false,
      })
      const reply = await client.chat({ model: "beam-free", messages: [], tools: [], session: "kb-a-b" })
      expect(reply.ttftMs).toBe(reply.latencyMs)
      const body = seen[0]?.body as { stream?: boolean } | undefined
      expect(body?.stream).toBeUndefined()
    } finally {
      await fake.close()
    }
  })

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
