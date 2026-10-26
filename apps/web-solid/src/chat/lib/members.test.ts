import { describe, expect, it } from "vitest"
import { keepArray, keepSpeakers } from "./members"

describe("keepArray", () => {
  it("keeps the previous array when contents are equal", () => {
    const previous = ["a", "b"]
    expect(keepArray(previous, ["a", "b"])).toBe(previous)
  })
  it("returns the new array when contents differ", () => {
    const next = ["a", "c"]
    expect(keepArray(["a", "b"], next)).toBe(next)
  })
})

describe("keepSpeakers", () => {
  const members = [
    { slug: "ada", name: "Ada", lead: true },
    { slug: "bo", name: "Bo" },
  ]
  it("keeps the map and entries when members are unchanged", () => {
    const first = keepSpeakers(undefined, members)
    expect(
      keepSpeakers(
        first,
        members.map((member) => ({ ...member })),
      ),
    ).toBe(first)
  })
  it("replaces only the renamed entry", () => {
    const first = keepSpeakers(undefined, members)
    const next = keepSpeakers(first, [members[0], { slug: "bo", name: "Bobby" }])
    expect(next).not.toBe(first)
    expect(next.get("ada")).toBe(first.get("ada"))
    expect(next.get("bo")?.name).toBe("Bobby")
    expect(next.get("ada")?.persona).toBe("lead")
  })
})
