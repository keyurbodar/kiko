import { describe, expect, test } from "bun:test"
import { type FileRef, KIKO, type LifeLine, type Member } from "@kiko/protocol"
import type { BotPresence } from "../../../lib/types"
import type { PlateLoop } from "../../info/loops"
import type { Routine } from "../../info/routines"
import { agentRows, comingUp, fileList, liveLine, memoryPick, since, statusChip, workingLine } from "./model"

const MIN = 60_000
const HOUR = 60 * MIN

const member = (slug: string, lead = false): Member => ({ slug, name: slug, lead }) as Member
const routine = (id: string, status: "active" | "paused"): Routine => ({ id, name: id, roomId: "r", status, trigger: { on: "time", at: "" } as never, tz: "UTC" })
const loop = (id: number): PlateLoop => ({ id, room: "r", text: `loop ${id}`, due: null, snoozedUntil: null })
const file = (name: string): FileRef => ({ id: name, name, size: 1, type: "text/plain" })
const line = (pos: number, at: number, extra: Partial<LifeLine> = {}): LifeLine => ({ pos, at, text: `line ${pos}`, source: "you", pinned: false, redacted: false, ...extra })

describe("statusChip", () => {
  const cases: [BotPresence | undefined, "Working" | "Idle"][] = [
    ["typing", "Working"],
    ["working", "Working"],
    ["idle", "Idle"],
    ["sleeping", "Idle"],
    [undefined, "Idle"],
  ]
  test.each(cases)("%p reads as %p", (presence, label) => {
    expect(statusChip(presence).label).toBe(label)
    expect(statusChip(presence).tone).toBe(label === "Working" ? "working" : "idle")
  })
})

describe("since", () => {
  const cases: [number, string][] = [
    [0, "just now"],
    [59_999, "just now"],
    [2 * MIN, "2m ago"],
    [59 * MIN, "59m ago"],
    [3 * HOUR, "3h ago"],
    [4 * 24 * HOUR, "4d ago"],
    [-5 * MIN, "just now"],
  ]
  test.each(cases)("%p ms is %p", (ms, text) => {
    expect(since(ms)).toBe(text)
  })
})

describe("liveLine", () => {
  const now = 10 * HOUR
  test("what the agents are doing wins", () => {
    expect(liveLine("Ada is editing /a.md", now - MIN, now)).toBe("Ada is editing /a.md")
  })
  test("otherwise the chat replied some time ago", () => {
    expect(liveLine(null, now - 2 * MIN, now)).toBe("Replied 2m ago")
    expect(liveLine(null, now, now)).toBe("Replied just now")
  })
  test("no activity at all reads as idle", () => {
    expect(liveLine(null, undefined, now)).toBe("Idle")
  })
})

describe("workingLine", () => {
  const cases: [{ name: string; doing?: string }[], boolean, string | null][] = [
    [[], false, null],
    [[{ name: "Ada", doing: "editing /a.md" }], true, "Ada is editing /a.md"],
    [[{ name: "Ada" }], true, "Ada is typing"],
    [[{ name: "Ada" }], false, "Typing"],
    [[{ name: "Ada" }, { name: "Lin" }], true, "Ada and Lin are typing"],
    [[{ name: "Ada", doing: "x" }, { name: "Lin" }], true, "Ada and Lin are typing"],
  ]
  test.each(cases)("%p (group %p)", (agents, group, text) => {
    expect(workingLine(agents, group)).toBe(text)
  })
})

describe("agentRows", () => {
  const none = () => undefined
  test("a single agent is never removable", () => {
    expect(agentRows([member(KIKO, true)], none)[0]?.removable).toBe(false)
  })
  test("in a group, Kiko stays and the others can leave", () => {
    const rows = agentRows([member(KIKO, true), member("ada"), member("lin")], none)
    expect(rows.map((r) => [r.slug, r.removable])).toEqual([
      [KIKO, false],
      ["ada", true],
      ["lin", true],
    ])
  })
  test("the lead flag and the status chip come from the member and presence", () => {
    const presence = (slug: string): BotPresence | undefined => (slug === "ada" ? "typing" : undefined)
    const rows = agentRows([member(KIKO, true), member("ada")], presence)
    expect(rows.map((r) => [r.lead, r.chip.label])).toEqual([
      [true, "Idle"],
      [false, "Working"],
    ])
  })
})

describe("comingUp", () => {
  test("active routines come before paused ones, and each keeps its order", () => {
    const out = comingUp([routine("p1", "paused"), routine("a1", "active"), routine("p2", "paused"), routine("a2", "active")], [])
    expect(out.routines.map((r) => r.id)).toEqual(["a1", "a2", "p1", "p2"])
  })
  test("plate items keep the order they came in", () => {
    expect(comingUp([], [loop(3), loop(1)]).loops.map((l) => l.id)).toEqual([3, 1])
  })
  test("nothing in, nothing out", () => {
    expect(comingUp([], [])).toEqual({ routines: [], loops: [] })
  })
})

describe("fileList", () => {
  const names = (n: number) => Array.from({ length: n }, (_, i) => file(`f${i + 1}.md`))
  const cases: [number, string[]][] = [
    [0, []],
    [3, ["f1.md", "f2.md", "f3.md"]],
    [5, ["f1.md", "f2.md", "f3.md", "f4.md", "f5.md"]],
    [7, ["f1.md", "f2.md", "f3.md", "f4.md", "f5.md"]],
  ]
  test.each(cases)("%p files show five at most, by name", (count, shown) => {
    expect(fileList(names(count)).map((f) => f.name)).toEqual(shown)
  })
  test("the order the room listed them in does not change which show", () => {
    expect(fileList([file("b.md"), file("c.md"), file("a.md")]).map((f) => f.name)).toEqual(["a.md", "b.md", "c.md"])
  })
})

describe("memoryPick", () => {
  test("the newest three lines that are not removed, newest first", () => {
    const lines = [line(1, 100), line(2, 500), line(3, 300, { redacted: true }), line(4, 400), line(5, 200)]
    expect(memoryPick(lines).map((l) => l.pos)).toEqual([2, 4, 5])
  })
  test("a removed line and a blank line never show", () => {
    expect(memoryPick([line(1, 1, { text: "   " }), line(2, 2, { text: "", redacted: true })])).toEqual([])
  })
  test("fewer lines than the limit show what there is", () => {
    expect(memoryPick([line(1, 1)]).map((l) => l.pos)).toEqual([1])
  })
  test("the input is not reordered", () => {
    const lines = [line(1, 100), line(2, 500)]
    memoryPick(lines)
    expect(lines.map((l) => l.pos)).toEqual([1, 2])
  })
})
