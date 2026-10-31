import {
  type AssistantMessage,
  type AssistantMessageEvent,
  createAssistantMessageEventStream,
  type Provider,
  type TranscriptContext,
} from "@earendil-works/pi-ai"
import { describe, expect, it } from "vitest"
import { scrubToolMarkup, withTextToolCalls } from "./tool-markup"

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

describe("a provider stream that throws", () => {
  it("ends with a real error message instead of hanging", async () => {
    const provider = (() => ({
      [Symbol.asyncIterator]() {
        return {
          next: async (): Promise<IteratorResult<never>> => {
            throw new Error("socket closed")
          },
        }
      },
    })) as unknown as Provider["streamSimple"]
    const out = withTextToolCalls(provider)(
      { api: "openai-completions", provider: "deepseek", id: "deepseek-v4.1-flash" } as never,
      context as never,
      {} as never,
    )
    const events: AssistantMessageEvent[] = []
    for await (const event of out) events.push(event)
    expect(events.at(-1)?.type).toBe("error")
    const message = await out.result()
    expect(message.stopReason).toBe("error")
    expect(message.errorMessage).toContain("socket closed")
  })
})

function eventsFor(chunks: readonly string[]): AssistantMessageEvent[] {
  const events: AssistantMessageEvent[] = [{ type: "text_start", contentIndex: 0, partial: answer("") }]
  let text = ""
  for (const chunk of chunks) {
    text += chunk
    events.push({ type: "text_delta", contentIndex: 0, delta: chunk, partial: answer(text) })
  }
  events.push({ type: "text_end", contentIndex: 0, content: text, partial: answer(text) })
  events.push({ type: "done", reason: "stop", message: answer(text) })
  return events
}

async function replay(events: readonly AssistantMessageEvent[]) {
  const provider = (() =>
    (async function* () {
      yield* events
    })()) as unknown as Provider["streamSimple"]
  const out = withTextToolCalls(provider)({} as never, context as never, {} as never)
  const shown: string[] = []
  let ended = ""
  let done: AssistantMessage | undefined
  for await (const event of out) {
    if (event.type === "text_delta") {
      const part = event.partial.content[0]
      shown.push(part?.type === "text" ? part.text : "")
    } else if (event.type === "text_end") ended = event.content
    else if (event.type === "done") done = event.message
    else if (event.type === "error") throw new Error(event.error.errorMessage)
  }
  return { shown, ended, done: done! }
}

const shape = (message: AssistantMessage) =>
  message.content.map((part) =>
    part.type === "text"
      ? { type: part.type, text: part.text }
      : part.type === "toolCall"
        ? { type: part.type, name: part.name, arguments: part.arguments }
        : { type: part.type },
  )

const MARKUP_TEXTS = [
  "hello world",
  "hello\nworld",
  "a < b and c > d",
  "5 < 10",
  "before<tool_call><function=bash><parameter=command>ls</parameter></function></tool_call>after",
  '<function_calls><invoke name="bash"><parameter name="command">ls</parameter></invoke></function_calls>',
  'checking.<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>bash\n```json\n{"command":"ls"}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>',
  '<|tool_calls_section_begin|><|tool_call_begin|>bash<|tool_call_argument_begin|>{"command":"ls"}<|tool_call_end|><|tool_calls_section_end|>',
  "<think>secret</think>answer",
  "<thinking>partial",
  "foo:function_calls>",
  "hi foo:function_cal",
  "\nfoo:function_cal",
  "</tool_result>foo:function_cal",
  "</tool_result>foo:function_calls>",
  "</tool_result>\nfoo:function_cal",
  "<think <tool_calls>",
  "<think <tool_ca",
  '<system-reminder attr="x">note</system-reminder>tail',
  "abc\n" + "a".repeat(45) + ":function_cal",
  "a".repeat(45) + ":function_calls>",
  "x".repeat(60) + "<tool_call>done</tool_call>",
  "<tool_response>ok</tool_response>",
  "<reasoning>why</reasoning>done",
  "<think\nfoo</think>",
  "<think\nfoo",
]

describe("a reply streamed in pieces", () => {
  it("shows and parses every prefix exactly as a fresh scan would", async () => {
    for (const text of MARKUP_TEXTS) {
      const many = await replay(eventsFor([...text]))
      let prefix = ""
      for (let index = 0; index < text.length; index++) {
        prefix += text[index]
        expect(many.shown[index]).toBe(scrubToolMarkup(prefix, false))
      }
      expect(many.ended).toBe(scrubToolMarkup(text, true))
      const fresh = await replay([{ type: "done", reason: "stop", message: answer(text) }])
      expect(shape(many.done)).toEqual(shape(fresh.done))
    }
  })

  it("gives the same result whatever the chunk size", async () => {
    for (const text of MARKUP_TEXTS) {
      const one = await replay(eventsFor(text ? [text] : []))
      const many = await replay(eventsFor([...text]))
      expect(one.shown.at(-1) ?? "").toBe(many.shown.at(-1) ?? "")
      expect(one.ended).toBe(many.ended)
      expect(shape(one.done)).toEqual(shape(many.done))
    }
  })
})
