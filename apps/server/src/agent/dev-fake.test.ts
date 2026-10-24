import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Harness, MemoryStorage } from "@earendil-works/pi-durable"
import { describe, expect, it } from "vitest"
import { fakeSetup } from "./dev-fake"

const context = BACKGROUND_CONTEXT

describe("fakeSetup", () => {
  it("answers in a room whose agent already ran on a real model", async () => {
    const setup = fakeSetup()
    const harness = await Harness.open(
      new MemoryStorage(),
      { models: setup.models, registry: setup.registry, settings: setup.settings },
      context,
    )
    harness.resume()
    const root = await harness.root(context, { agent: setup.agent })
    await root.configure({ model: { provider: "opencode-go", modelId: "deepseek-v4.1-flash" } }, context)

    expect(await setup.beginRun({ requestId: "first", envelopes: [], briefs: [] }, root)).toBe(true)
    const submission = await root.submit({ type: "input", content: "[tools]" }, context)
    expect(await submission.wait(context)).toMatchObject({ status: "done" })

    const replies = (await root.context(context)).messages.filter((m) => m.role === "assistant")
    expect(replies).toMatchObject([{ content: [{ type: "text", text: expect.stringMatching(/^tools: /) }] }])
    await harness.close(context)
  })
})
