import { describe, expect, test } from "bun:test"
import { browserState, hostOf } from "../src/integrations/kernel/connect"
import type { LeaseRow } from "../src/integrations/kernel/store"

const row = (over: Partial<LeaseRow> = {}): LeaseRow => ({
  sessionId: "s1",
  mode: "headless",
  createdAt: 1000,
  lastUse: 1000,
  tabs: { "room/ada": { t1: "https://github.com/login?token=secret", t2: "about:blank" } },
  takeover: false,
  watchUntil: 0,
  dead: false,
  ...over,
})
const resolve = (id: string) => ({ slug: id.split("/").pop()!, name: "Ada" })

describe("browser state for the client", () => {
  test("holds hosts and never a page URL", () => {
    const state = browserState(row(), false, resolve)
    expect(state?.tabs).toEqual([
      { agent: "Ada", slug: "ada", host: "github.com" },
      { agent: "Ada", slug: "ada", host: "blank" },
    ])
    expect(JSON.stringify(state)).not.toMatch(/secret|https?:/)
  })

  test("carries the takeover and switching flags", () => {
    expect(browserState(row({ takeover: true }), true, resolve)).toMatchObject({ takeover: true, switching: true, mode: "headless", since: 1000 })
  })

  test("is null with no browser or a dead one", () => {
    expect(browserState(undefined, false, resolve)).toBeNull()
    expect(browserState(row({ dead: true }), false, resolve)).toBeNull()
  })

  test("a bad URL is a blank host", () => {
    expect(hostOf("not a url")).toBe("blank")
  })
})
