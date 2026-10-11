import { describe, expect, test } from "bun:test"
import { ComposioError } from "../src/integrations/composio/client"
import { createLimiter } from "../src/integrations/composio/limit"
import { composioExtension } from "../src/integrations/composio/tools"

type Tool = { execute: (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }
const ctx = { conversationId: "c", callId: "1" }
const tool = (readOnly: boolean, call: Parameters<typeof composioExtension>[1]) =>
  (composioExtension([{ name: "COMPOSIO_X", inputSchema: {}, readOnly }], call).tools as unknown as Tool[])[0]!
const turn = () => new Promise<void>((r) => setImmediate(r))

describe("composio limiter", () => {
  test("never exceeds max in flight over 100 calls and keeps results", async () => {
    const limiter = createLimiter(5)
    let active = 0
    let peak = 0
    const out = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        limiter.run(async () => {
          peak = Math.max(peak, ++active)
          await turn()
          active--
          return i
        }),
      ),
    )
    expect(out).toEqual(Array.from({ length: 100 }, (_, i) => i))
    expect(peak).toBe(5)
  })

  test("a throw frees its slot", async () => {
    const limiter = createLimiter(1)
    expect(await limiter.run(async () => Promise.reject(new Error("x"))).catch((e) => e.message)).toBe("x")
    expect(await limiter.run(async () => "ok")).toBe("ok")
  })

  test("a read-only call retries on 429 then succeeds", async () => {
    let n = 0
    const t = tool(true, async () => {
      if (++n < 2) throw new ComposioError("slow down", 429)
      return { content: [{ type: "text", text: "done" }] }
    })
    const out = await t.execute({}, ctx)
    expect(n).toBe(2)
    expect(out.content[0]!.text).toBe("done")
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

  test("each extension has its own limiter", async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>()
    let started = 0
    const blocked = async () => {
      started++
      await gate
      return { content: [] }
    }
    const a = tool(false, blocked)
    const b = tool(false, blocked)
    const first = Array.from({ length: 40 }, () => a.execute({}, ctx))
    const queued = a.execute({}, ctx)
    const other = b.execute({}, ctx)
    await turn()
    await turn()
    expect(started).toBe(41)
    release()
    await Promise.all([...first, queued, other])
  })
})
