import { describe, expect, it } from "vitest"
import type { Channel } from "../cdp/session"
import { read, type PageState } from "./read"
import type { PageView } from "./types"

const view: PageView = {
  key: "k",
  url: "https://example.com/",
  title: "Example",
  controls: [],
  text: "hello",
  omitted: 0,
}

describe("read", () => {
  it("reads once even when a load is still in flight", async () => {
    const sent: string[] = []
    const channel = {
      sessionId: undefined,
      send: async (method: string) => {
        sent.push(method)
        return { result: { value: JSON.stringify(view) } }
      },
      on: () => () => {},
      waitFor: async () => undefined,
    } as unknown as Channel
    const page: PageState = {
      channel,
      targetId: "t1",
      labels: new Map(),
      notes: [],
      loading: Promise.resolve(),
    }
    const out = await read(page)
    expect(sent).toEqual(["Runtime.evaluate"])
    expect(out.title).toBe("Example")
  })
})
