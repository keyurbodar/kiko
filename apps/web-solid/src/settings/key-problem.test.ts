import { describe, expect, it } from "vitest"
import { splitKeyProblemText } from "./key-problem"

describe("splitKeyProblemText", () => {
  it("separates a trailing status code from the sentence", () => {
    expect(splitKeyProblemText("OpenRouter didn't recognize that key. · 401")).toEqual({
      sentence: "OpenRouter didn't recognize that key.",
      status: 401,
    })
  })

  it("leaves a sentence without a status alone", () => {
    expect(splitKeyProblemText("Couldn't reach OpenRouter. Check your connection.")).toEqual({
      sentence: "Couldn't reach OpenRouter. Check your connection.",
    })
  })
})
