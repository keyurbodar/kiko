import { expect, test } from "bun:test"
import { userModels } from "../src/agent/factory"

const tool = { name: "recall", description: "search the chat", parameters: { type: "object", properties: {} } }

/** The body a run sends for `modelId`, with the transcript pi-durable builds: the input first, its system entry after. */
async function requestBody(modelId: string): Promise<{ tools?: unknown[]; messages: { role: string; content?: unknown; tools?: unknown }[] }> {
  let sent: string | undefined
  const egress = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent = init?.body as string
    return new Response("{}", { status: 500 })
  }) as typeof fetch
  const { models } = userModels(async () => ({ auth: { apiKey: "sk-test" } }) as never, "s1", egress)
  const model = models.getModel("opencode-go", modelId)!
  const messages = [
    { role: "user", content: "Hi", timestamp: 1 },
    { role: "system", content: "you are kiko", toolsAdded: [tool], timestamp: 2 },
  ]
  await models.streamSimple(model, { messages } as never, {}).result()
  return JSON.parse(sent!)
}

test("a model that may add tools mid-conversation gets every tool in the tools field, never a system message without content", async () => {
  const body = await requestBody("kimi-k3")
  expect(body.messages.filter((m) => m.content === undefined)).toEqual([])
  expect(body.tools).toHaveLength(1)
})

test("other models send the same shape", async () => {
  const body = await requestBody("deepseek-v4.1-flash")
  expect(body.messages.filter((m) => m.content === undefined)).toEqual([])
  expect(body.tools).toHaveLength(1)
})
