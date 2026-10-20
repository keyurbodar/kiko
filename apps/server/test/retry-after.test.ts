import { expect, test } from "bun:test"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import { retryAssistantCall } from "@earendil-works/pi-ai/utils/retry"
import { userModels } from "../src/agent/factory"
import { RETRY, RETRY_AFTER_TOO_LONG, retrying } from "../src/agent/retry"
import { classifyRunError } from "../src/agent/run-error"

const policy = { ...RETRY }

test("Retry-After waits up to 60 seconds and ends longer waits as a rate-limit bubble", async () => {
  const short = attemptsOf([() => tooMany({ "retry-after": "3" }), () => answer("hello")])
  const answered = await retryAssistantCall(short.produce, policy, undefined, short.attempts)
  expect(answered.stopReason).toBe("stop")
  expect(short.sent).toHaveLength(2)
  expect(short.sent[1]!.at - short.sent[0]!.at).toBeGreaterThanOrEqual(3_000)
  expect(short.attempts.messages).toEqual(["retrying, 1 of 3"])

  const long = attemptsOf([() => tooMany({ "retry-after": "61" })])
  const refused = await retryAssistantCall(long.produce, policy, undefined, long.attempts)
  expect(refused.stopReason).toBe("error")
  expect(long.sent).toHaveLength(1)
  expect(long.attempts.messages).toEqual([])
  expect(refused.errorMessage).toContain(RETRY_AFTER_TOO_LONG)
  expect(classifyRunError(refused.errorMessage)).toBe("rate_limit")
}, 30_000)

type Sent = { at: number }

type Attempts = {
  messages: string[]
  onRetryScheduled: (attempt: number) => void
}

function attemptsOf(script: (() => Response)[]): { produce: () => Promise<AssistantMessage>; sent: Sent[]; attempts: Attempts } {
  const sent: Sent[] = []
  const messages: string[] = []
  const egress = (async () => {
    sent.push({ at: Date.now() })
    const next = script.shift()
    if (!next) throw new Error("the run sent a request the script does not answer")
    return next()
  }) as typeof fetch
  const { models } = userModels(async () => ({ apiKey: "test-key" }) as never, "s1", egress)
  const provider = models.getProvider("anthropic")!
  const model = provider.getModels()[0]!
  const produce = async () =>
    provider.streamSimple(model, { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] } as never, { apiKey: "test-key" } as never).result()
  return { produce, sent, attempts: { messages, onRetryScheduled: (attempt) => messages.push(retrying(attempt)) } }
}

function tooMany(extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "rate limited" } }), {
    status: 429,
    headers: { "content-type": "application/json", ...extra },
  })
}

function answer(text: string): Response {
  const events: [string, object][] = [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-test", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }],
    ["message_stop", { type: "message_stop" }],
  ]
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("")
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
}
