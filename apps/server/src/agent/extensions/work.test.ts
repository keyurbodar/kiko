import { describe, expect, it } from "vitest"
import { workerThinking } from "./work"

describe("workerThinking", () => {
  it("runs at the parent's level when the job asks for none", () => {
    expect(workerThinking("high", undefined)).toBe("high")
  })

  it("lowers a worker for a lookup job", () => {
    expect(workerThinking("high", "minimal")).toBe("minimal")
    expect(workerThinking("medium", "off")).toBe("off")
  })

  it("never runs a worker above its parent", () => {
    expect(workerThinking("low", "xhigh")).toBe("low")
    expect(workerThinking("off", "max")).toBe("off")
  })
})
