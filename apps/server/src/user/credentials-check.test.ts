import { describe, expect, it } from "vitest"
import { keyProblem, keyProblemText } from "./credentials-check"

describe("provider key problems", () => {
  it("asks the owner to copy the whole key when the provider refuses it", () => {
    expect(keyProblem("OpenRouter", '401: {"message":"User not found.","code":401}')).toEqual({
      sentence: "OpenRouter didn't recognize that key. Check that you copied all of it.",
      status: 401,
    })
    expect(keyProblem("Google", "403 forbidden")).toEqual({
      sentence: "Google didn't recognize that key. Check that you copied all of it.",
      status: 403,
    })
  })

  it("explains a rate limit and a provider outage", () => {
    expect(keyProblem("Anthropic", "429 too many requests")).toEqual({
      sentence: "Anthropic is rate limiting this key. Try again in a minute.",
      status: 429,
    })
    expect(keyProblem("OpenAI", "503 upstream unavailable")).toEqual({
      sentence: "OpenAI is having trouble right now. Try again in a minute.",
      status: 503,
    })
  })

  it("treats a refusal without a status code as an unrecognized key", () => {
    expect(keyProblem("OpenRouter", "invalid api key")).toEqual({
      sentence: "OpenRouter didn't recognize that key. Check that you copied all of it.",
    })
  })

  it("falls back to a plain refusal for any other status", () => {
    expect(keyProblem("Mistral", "400 bad request")).toEqual({
      sentence: "Mistral rejected that key.",
      status: 400,
    })
  })

  it("shows the status as a quiet suffix only when there is one", () => {
    expect(keyProblemText("OpenRouter", "401 unauthorized")).toBe(
      "OpenRouter didn't recognize that key. Check that you copied all of it. · 401",
    )
    expect(keyProblemText("OpenRouter", "unauthorized")).toBe(
      "OpenRouter didn't recognize that key. Check that you copied all of it.",
    )
  })
})
