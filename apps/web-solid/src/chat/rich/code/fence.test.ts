import { describe, expect, it } from "vitest"
import { extractFenceTitle } from "./fence"

describe("extractFenceTitle", () => {
  it("reads a quoted title attribute", () => {
    expect(extractFenceTitle('ts title="src/app.ts"')).toBe("src/app.ts")
    expect(extractFenceTitle("ts title='app.ts'")).toBe("app.ts")
  })

  it("reads file and filename attributes without quotes", () => {
    expect(extractFenceTitle("ts file=app.ts")).toBe("app.ts")
    expect(extractFenceTitle("ts filename=app.ts")).toBe("app.ts")
  })

  it("falls back to a bare file name token", () => {
    expect(extractFenceTitle("split.py")).toBe("split.py")
    expect(extractFenceTitle("python split.py")).toBe("split.py")
  })

  it("returns null when the fence names no file", () => {
    expect(extractFenceTitle(undefined)).toBeNull()
    expect(extractFenceTitle("")).toBeNull()
    expect(extractFenceTitle("python")).toBeNull()
    expect(extractFenceTitle("python showLineNumbers")).toBeNull()
  })
})
