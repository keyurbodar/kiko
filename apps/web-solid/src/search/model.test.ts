import { describe, expect, test } from "bun:test"
import type { MessageId, RoomId } from "@kiko/protocol"
import { createSearch, type Hit, type HitPage, PAGE_AHEAD, SEARCH_DEBOUNCE_MS, senderName, type Timer } from "./model"
import type { SearchScope } from "./state"

/** A timer the test advances by hand. */
function fakeTimer() {
  let now = 0
  const queue: { at: number; run: () => void; id: number }[] = []
  let ids = 0
  const timer: Timer = {
    set(run, ms) {
      const id = ++ids
      queue.push({ at: now + ms, run, id })
      return id
    },
    clear(id) {
      const i = queue.findIndex((x) => x.id === id)
      if (i !== -1) queue.splice(i, 1)
    },
  }
  const advance = (ms: number) => {
    now += ms
    for (const due of queue.filter((x) => x.at <= now)) {
      queue.splice(queue.indexOf(due), 1)
      due.run()
    }
  }
  return { timer, advance }
}

const hit = (seq: number, roomId = "r1"): Hit => ({ roomId: roomId as RoomId, id: `m${seq}` as MessageId, seq, at: seq, from: { kind: "human" }, snippet: `n${seq}` })
const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(answer: (scope: SearchScope, query: string, before?: number) => HitPage | null | Promise<HitPage | null>) {
  const { timer, advance } = fakeTimer()
  const asked: [SearchScope, string, number | undefined][] = []
  const search = createSearch({
    scope: "chat",
    timer,
    onChange() {},
    fetch: async (scope, query, before) => {
      asked.push([scope, query, before])
      return answer(scope, query, before)
    },
  })
  return { search, asked, advance }
}

describe("createSearch", () => {
  test("typing waits for a pause, then asks once with the last query", async () => {
    const { search, asked, advance } = setup(() => ({ results: [hit(3)], next: null }))
    search.type("h")
    advance(50)
    search.type("he")
    advance(50)
    search.type("hel")
    expect(asked).toEqual([])
    expect(search.view().status).toBe("loading")
    advance(SEARCH_DEBOUNCE_MS)
    await flush()
    expect(asked).toEqual([["chat", "hel", undefined]])
    expect(search.view()).toMatchObject({ status: "done", hits: [hit(3)], selected: 0 })
  })

  test("an answer to an older query is dropped", async () => {
    const waits: ((p: HitPage) => void)[] = []
    const { search, advance } = setup(() => new Promise<HitPage>((resolve) => waits.push(resolve)))
    search.type("a")
    advance(SEARCH_DEBOUNCE_MS)
    search.type("ab")
    advance(SEARCH_DEBOUNCE_MS)
    waits[1]!({ results: [hit(2)], next: null })
    await flush()
    waits[0]!({ results: [hit(1)], next: null })
    await flush()
    expect(search.view().hits.map((h) => h.seq)).toEqual([2])
  })

  test("clearing the field empties the list and cancels the pending ask", async () => {
    const { search, asked, advance } = setup(() => ({ results: [hit(1)], next: null }))
    search.type("x")
    search.type("  ")
    advance(SEARCH_DEBOUNCE_MS)
    await flush()
    expect(asked).toEqual([])
    expect(search.view()).toMatchObject({ status: "idle", hits: [] })
  })

  test("a new scope asks at once, without the debounce", async () => {
    const { search, asked, advance } = setup((scope) => ({ results: [hit(scope === "all" ? 9 : 1)], next: null }))
    search.type("q")
    advance(SEARCH_DEBOUNCE_MS)
    await flush()
    search.setScope("all")
    await flush()
    expect(asked.at(-1)).toEqual(["all", "q", undefined])
    expect(search.view().hits.map((h) => h.seq)).toEqual([9])
  })

  test("arrows clamp, and nearing the end pages once with the cursor", async () => {
    const first = Array.from({ length: 8 }, (_, i) => hit(100 - i))
    const { search, asked, advance } = setup((_, __, before) =>
      before === undefined ? { results: first, next: 93 } : { results: [hit(92), hit(91), hit(100)], next: null },
    )
    search.type("n")
    advance(SEARCH_DEBOUNCE_MS)
    await flush()
    search.move(-1)
    expect(search.view().selected).toBe(0)
    search.move(8 - PAGE_AHEAD - 1)
    expect(asked).toHaveLength(1)
    search.move(1)
    search.move(1) // a second step while the page loads does not ask again
    await flush()
    expect(asked).toEqual([["chat", "n", undefined], ["chat", "n", 93]])
    // The page is appended without repeating a hit the list already has.
    expect(search.view().hits.map((h) => h.seq)).toEqual([100, 99, 98, 97, 96, 95, 94, 93, 92, 91])
    expect(search.view().next).toBeNull()
    search.move(100)
    expect(search.view().selected).toBe(9)
  })

  test("a failed ask says so", async () => {
    const { search, advance } = setup(() => null)
    search.type("q")
    advance(SEARCH_DEBOUNCE_MS)
    await flush()
    expect(search.view().status).toBe("error")
  })
})

test("senderName names the human, agents by their name, and the system as Yuki", () => {
  const agents = [{ slug: "piko" as never, name: "Piko" }]
  expect(senderName({ kind: "human" }, agents)).toBe("You")
  expect(senderName({ kind: "agent", slug: "piko" as never }, agents)).toBe("Piko")
  expect(senderName({ kind: "agent", slug: "zed" as never }, agents)).toBe("zed")
  expect(senderName({ kind: "system", reason: "reminder" } as never, agents)).toBe("Yuki")
})
