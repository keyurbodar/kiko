import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Provider,
  type TranscriptContext,
} from "@earendil-works/pi-ai"
import { describe, expect, it } from "vitest"
import { withTextToolCalls } from "./tool-markup"

const context = {
  messages: [
    {
      role: "system",
      content: "",
      timestamp: 0,
      toolsAdded: [
        {
          name: "bash",
          description: "run a command",
          parameters: { type: "object", properties: { command: { type: "string" } } },
        },
      ],
    },
  ],
} as unknown as TranscriptContext

function answer(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-v4.1-flash",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  } as AssistantMessage
}

async function finalOf(message: AssistantMessage): Promise<AssistantMessage> {
  const provider = (() => {
    const stream = createAssistantMessageEventStream()
    stream.push({ type: "done", reason: "stop", message } as never)
    stream.end()
    return stream
  }) as unknown as Provider["streamSimple"]
  const out = withTextToolCalls(provider)({} as never, context as never, {} as never)
  let last: AssistantMessage | undefined
  for await (const event of out) if (event.type === "done") last = event.message
  return last!
}

const callsOf = (message: AssistantMessage) =>
  message.content.flatMap((part) => (part.type === "toolCall" ? [{ name: part.name, arguments: part.arguments }] : []))

describe("deepseek text tool calls", () => {
  it("reads the V3 format with a fenced json body", async () => {
    const message = await finalOf(
      answer(
        'checking.<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>bash\n```json\n{"command":"ls"}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>',
      ),
    )
    expect(callsOf(message)).toEqual([{ name: "bash", arguments: { command: "ls" } }])
    expect(message.stopReason).toBe("toolUse")
  })

  it("reads the V3.1 format with the name before the separator, even when the args hold <", async () => {
    const message = await finalOf(
      answer(
        '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>bash<｜tool▁sep｜>{"command":"echo \\"<b>\\" > out.html"}<｜tool▁call▁end｜><｜tool▁call▁begin｜>bash<｜tool▁sep｜>{"command":"ls"}<｜tool▁call▁end｜><｜tool▁calls▁end｜>',
      ),
    )
    expect(callsOf(message)).toEqual([
      { name: "bash", arguments: { command: 'echo "<b>" > out.html' } },
      { name: "bash", arguments: { command: "ls" } },
    ])
  })

  it("runs the complete calls of an answer cut off by the length limit and drops the torn one", async () => {
    const message = await finalOf(
      answer(
        '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>bash<｜tool▁sep｜>{"command":"ls"}<｜tool▁call▁end｜><｜tool▁call▁begin｜>bash<｜tool▁sep｜>{"command":"ca',
        "length",
      ),
    )
    expect(callsOf(message)).toEqual([{ name: "bash", arguments: { command: "ls" } }])
    expect(message.stopReason).toBe("toolUse")
  })
})
