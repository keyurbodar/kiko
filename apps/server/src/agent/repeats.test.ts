import type { ConversationId } from "@earendil-works/pi-durable"
import { describe, expect, it } from "vitest"
import { RepeatGuard } from "./repeats"

const c1 = 1 as ConversationId
const c2 = 2 as ConversationId
const poll = (id: string) => ({ id, name: "bash", arguments: { command: "sleep 30; curl https://x.dev/status" } })
const read = (id: string, path = "/a.md") => ({ id, name: "read", arguments: { path } })

describe("repeat guard", () => {
  it("refuses the third identical call in a row", () => {
    const guard = new RepeatGuard()
    expect(guard.check(c1, poll("1"), "write")).toBeUndefined()
    expect(guard.check(c1, poll("2"), "write")).toBeUndefined()
    expect(guard.check(c1, poll("3"), "write")).toMatch(/exact call twice/)
  })

  it("matches arguments whatever their key order", () => {
    const guard = new RepeatGuard()
    const call = (id: string, args: object) => ({ id, name: "list_routines", arguments: args })
    guard.check(c1, call("1", { a: 1, b: { c: 2, d: 3 } }), "read")
    guard.check(c1, call("2", { b: { d: 3, c: 2 }, a: 1 }), "read")
    expect(guard.check(c1, call("3", { a: 1, b: { c: 2, d: 3 } }), "read")).toMatch(/exact call twice/)
  })

  it("lets a read repeat once something was written in between", () => {
    const guard = new RepeatGuard()
    const edit = (id: string, text: string) => ({ id, name: "edit", arguments: { path: "/a.md", text } })
    guard.check(c1, read("1"), "read")
    guard.check(c1, edit("2", "one"), "write")
    guard.check(c1, read("3"), "read")
    guard.check(c1, edit("4", "two"), "write")
    expect(guard.check(c1, read("5"), "read")).toBeUndefined()
  })

  it("counts a retried call once, and keeps conversations and runs apart", () => {
    let run = "r1"
    const guard = new RepeatGuard(() => run)
    guard.check(c1, poll("1"), "write")
    guard.check(c1, poll("1"), "write")
    guard.check(c2, poll("2"), "write")
    expect(guard.check(c1, poll("3"), "write")).toBeUndefined()
    run = "r2"
    expect(guard.check(c1, poll("4"), "write")).toBeUndefined()
    expect(guard.check(c1, poll("5"), "write")).toBeUndefined()
    expect(guard.check(c1, poll("6"), "write")).toMatch(/exact call twice/)
  })

  it("forgets calls that slid out of the last eight", () => {
    const guard = new RepeatGuard()
    guard.check(c1, read("1"), "read")
    guard.check(c1, read("2"), "read")
    for (let i = 0; i < 8; i++) guard.check(c1, read(`other-${i}`, `/${i}.md`), "read")
    expect(guard.check(c1, read("3"), "read")).toBeUndefined()
  })
})
