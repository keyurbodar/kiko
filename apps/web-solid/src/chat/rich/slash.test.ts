import { describe, expect, it } from "vitest"
import type { Token } from "../../composer/tokens"
import { slashPieces } from "./slash"

const recipe = (name: string): Token => ({ kind: "recipe", id: name, name, title: name, hint: "" })
const known = (name: string) => (name === "daily-weather" ? recipe(name) : undefined)

describe("slashPieces", () => {
  it("turns a known /name into a token and leaves the rest as text", () => {
    expect(slashPieces("run /daily-weather, then /nope or a/b", known)).toEqual([
      { text: "run " },
      { token: recipe("daily-weather") },
      { text: ", then /nope or a/b" },
    ])
  })

  it("keeps plain text whole", () => {
    expect(slashPieces("no tokens here", known)).toEqual([{ text: "no tokens here" }])
  })
})
