import { describe, expect, test } from "bun:test"
import { openVsxTarget } from "../src/themes/open-vsx-route"

describe("the Open VSX proxy accepts only open-vsx.org API addresses", () => {
  test("a https address under /api on open-vsx.org is fetched", () => {
    expect(openVsxTarget("https://open-vsx.org/api/-/search?query=dark")).toBe("https://open-vsx.org/api/-/search?query=dark")
  })

  test.each([
    ["another host", "https://evil.example/api/x"],
    ["a subdomain", "https://x.open-vsx.org/api/x"],
    ["plain http", "http://open-vsx.org/api/x"],
    ["a path outside /api", "https://open-vsx.org/x"],
    ["credentials", "https://user:pw@open-vsx.org/api/x"],
    ["a port", "https://open-vsx.org:8443/api/x"],
    ["not a URL", "open-vsx.org/api/x"],
    ["no address", null],
  ])("refuses %s", (_, raw) => {
    expect(openVsxTarget(raw)).toBeNull()
  })
})
