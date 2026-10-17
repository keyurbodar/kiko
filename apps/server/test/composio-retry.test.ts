import { describe, expect, test } from "bun:test"
import { ComposioError } from "../src/integrations/composio/client"
import { composioExtension } from "../src/integrations/composio/tools"

type Tool = { execute: (args: unknown, ctx: unknown) => Promise<{ output: { text: string }[]; isError?: boolean }> }
const ctx = { conversationId: "c", callId: "1" }
const tool = (readOnly: boolean, call: Parameters<typeof composioExtension>[1]) =>
  (composioExtension([{ name: "COMPOSIO_X", inputSchema: {}, readOnly }], call).tools as unknown as Tool[])[0]!

describe("composio retry", () => {
  test("a read-only call retries on 429 then succeeds", async () => {
    let n = 0
    const t = tool(true, async () => {
      if (++n < 2) throw new ComposioError("slow down", 429)
      return { output: [{ type: "text", text: "done" }] }
    })
    const out = await t.execute({}, ctx)
    expect(n).toBe(2)
    expect(out.output[0]!.text).toBe("done")
  })

  test("an external call is not retried on 429", async () => {
    let n = 0
    const t = tool(false, async () => {
      n++
      throw new ComposioError("slow down", 429)
    })
    const out = await t.execute({}, ctx)
    expect(n).toBe(1)
    expect(out.isError).toBe(true)
  })
})
