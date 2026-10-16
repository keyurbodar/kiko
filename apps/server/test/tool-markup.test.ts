import { describe, expect, test } from "bun:test"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { Type } from "@earendil-works/pi-ai"
import { parseToolMarkup, scrubToolMarkup, withTextToolCalls } from "../src/agent/tool-markup"

// The text a user saw in a bubble: the first `<` and the `>` of the opening tag are gone.
const SAMPLE = `Hi! I will warn you on high pollen days, and stay quiet otherwise.
atem:function_calls
<atem:invoke name="default.ask_human">
<atem:parameter name="questions">[{"header": "Your city", "id": "city", "question": "What city are you in?"}]</atem:parameter>
</atem:invoke>
</atem:function_calls>`

describe("parseToolMarkup", () => {
  test("a call whose opening tag lost its brackets is a call, and the prose stays", () => {
    const { prose, calls } = parseToolMarkup(SAMPLE, true)
    expect(prose.trim()).toBe("Hi! I will warn you on high pollen days, and stay quiet otherwise.")
    expect(calls).toEqual([{ name: "default.ask_human", args: { questions: '[{"header": "Your city", "id": "city", "question": "What city are you in?"}]' } }])
  })

  test("a namespaced and a bare opening tag both parse", () => {
    const text = '<function_calls><invoke name="send"><parameter name="to">ada</parameter></invoke></function_calls>after'
    expect(parseToolMarkup(text, true)).toEqual({ prose: "after", calls: [{ name: "send", args: { to: "ada" } }] })
  })

  test("a Hermes call", () => {
    const { prose, calls } = parseToolMarkup('On it.<tool_call>{"name":"web_fetch","arguments":{"url":"https://a.test"}}</tool_call>', true)
    expect(prose).toBe("On it.")
    expect(calls).toEqual([{ name: "web_fetch", args: { url: "https://a.test" } }])
  })

  test("a Kimi call", () => {
    const text = 'Checking.<|tool_calls_section_begin|><|tool_call_begin|>functions.web_fetch:0<|tool_call_argument_begin|>{"url":"https://a.test"}<|tool_call_end|><|tool_calls_section_end|>'
    expect(parseToolMarkup(text, true)).toEqual({ prose: "Checking.", calls: [{ name: "web_fetch", args: { url: "https://a.test" } }] })
  })

  test("a DeepSeek call", () => {
    const text = 'Checking.<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>web_fetch\n```json\n{"url":"https://a.test"}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>'
    expect(parseToolMarkup(text, true)).toEqual({ prose: "Checking.", calls: [{ name: "web_fetch", args: { url: "https://a.test" } }] })
  })

  test("thinking and tool results are removed, also when unterminated", () => {
    expect(scrubToolMarkup("<think>plan</think>Hello <tool_result>42</tool_result>there")).toBe("Hello there")
    expect(scrubToolMarkup("Hello<think>I should")).toBe("Hello")
    expect(scrubToolMarkup("Hello\n<atem:function_calls>\n<atem:invoke name=\"x\">")).toBe("Hello\n")
  })

  test("while streaming, a tail that may open a span is held back and ordinary text is not", () => {
    for (const cut of ["Hi\n<", "Hi\n<atem:func", "Hi\natem:function_c", "Hi\n<tool_c"]) expect(scrubToolMarkup(cut, false)).toBe("Hi\n")
    expect(scrubToolMarkup("a < b is true", false)).toBe("a < b is true")
    expect(scrubToolMarkup("Note:", false)).toBe("")
    expect(scrubToolMarkup("Note: all good", false)).toBe("Note: all good")
  })

  test("every prefix of the sample shows no markup and only grows", () => {
    let shown = ""
    for (let i = 0; i <= SAMPLE.length; i++) {
      const next = scrubToolMarkup(SAMPLE.slice(0, i), false)
      expect(next).not.toMatch(/function_calls|invoke|<|atem/)
      expect(next.startsWith(shown)).toBe(true)
      shown = next
    }
  })
})

describe("withTextToolCalls", () => {
  const tool = { name: "ask_human", description: "asks", parameters: Type.Object({ questions: Type.Array(Type.Object({ id: Type.String() })), note: Type.Optional(Type.String()) }) }

  async function run(text: string) {
    const faux = fauxProvider({ tokensPerSecond: 2000 })
    faux.setResponses([fauxAssistantMessage(text)])
    const models = createModels()
    models.setProvider({ ...faux.provider, streamSimple: withTextToolCalls(faux.provider.streamSimple) })
    const model = models.getModel("faux", "faux-1") ?? (faux.provider as never as { models: never[] }).models[0]
    const stream = models.streamSimple(model as never, { messages: [{ role: "user", content: "hi", timestamp: 0 }], tools: [tool] } as never, {})
    const partials: string[] = []
    for await (const event of stream) if ("partial" in event) partials.push(JSON.stringify(event.partial.content))
    return { message: await stream.result(), partials }
  }

  test("the sample becomes a real ask_human call with parsed parameters, and the text part is only the prose", async () => {
    const { message, partials } = await run(SAMPLE)
    expect(message.stopReason).toBe("toolUse")
    expect(message.content.map((p) => p.type)).toEqual(["text", "toolCall"])
    expect(message.content[0]).toMatchObject({ text: "Hi! I will warn you on high pollen days, and stay quiet otherwise.\n" })
    expect(message.content[1]).toMatchObject({ name: "ask_human", arguments: { questions: [{ id: "city" }] } })
    for (const partial of partials) expect(partial).not.toMatch(/function_calls|invoke|atem/)
  })

  test("a Hermes call is mapped and a string parameter stays a string", async () => {
    const { message } = await run('<tool_call>{"name":"ask_human","arguments":{"questions":[],"note":"12"}}</tool_call>')
    expect(message.stopReason).toBe("toolUse")
    expect(message.content).toHaveLength(1)
    expect(message.content[0]).toMatchObject({ type: "toolCall", name: "ask_human", arguments: { questions: [], note: "12" } })
  })

  test("plain text is untouched", async () => {
    const { message } = await run("Just words.")
    expect(message.stopReason).toBe("stop")
    expect(message.content).toMatchObject([{ type: "text", text: "Just words." }])
  })
})
