import { describe, expect, it } from "vitest"
import { resumedStep, resumeLine } from "./steps"

describe("resuming onboarding", () => {
  it("welcomes the owner back only when the page opened already signed in and partway through", () => {
    expect(resumedStep({ fresh: false, acted: false, step: "connect" })).toBe("connect")
    expect(resumedStep({ fresh: false, acted: false, step: "model" })).toBe("model")
    expect(resumedStep({ fresh: true, acted: false, step: "connect" })).toBeNull()
    expect(resumedStep({ fresh: false, acted: true, step: "connect" })).toBeNull()
    expect(resumedStep({ fresh: false, acted: false, step: "sign-in" })).toBeNull()
    expect(resumedStep({ fresh: false, acted: false, step: "done" })).toBeNull()
  })

  it("says where the owner stopped and what is already set up", () => {
    expect(resumeLine("connect", false)).toBe("You stopped at Provider.")
    expect(resumeLine("model", true)).toBe("You stopped at Model. Cloudflare is ready.")
  })
})
