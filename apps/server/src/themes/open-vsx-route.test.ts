import { afterEach, describe, expect, it, vi } from "vitest"
import { safeFetch } from "@kiko/durable/safe-fetch"
import { signToken } from "../auth/auth"
import type { Env } from "../index"
import { openVsxRoute } from "./open-vsx-route"

vi.mock("@kiko/durable/safe-fetch", () => ({ safeFetch: vi.fn() }))

const fetchMock = vi.mocked(safeFetch)
const TARGET = "https://open-vsx.org/api/foo/bar"

const env = { SESSION_SECRET: "s" } as unknown as Env

async function request(): Promise<Request> {
  const token = await signToken("s", "owner", "session")
  return new Request(`https://kiko.test/api/open-vsx?url=${encodeURIComponent(TARGET)}`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

describe("open-vsx proxy", () => {
  afterEach(() => fetchMock.mockReset())

  it("serves an upstream page as an inert attachment on the app origin", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      url: TARGET,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: new TextEncoder().encode("<script>alert(1)</script>"),
      truncated: false,
    })
    const response = await openVsxRoute(await request(), env)
    expect(response?.headers.get("content-type")).toBe("application/octet-stream")
    expect(response?.headers.get("content-security-policy")).toBe("sandbox")
    expect(response?.headers.get("content-disposition")).toBe("attachment")
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("refuses an address outside Open VSX", async () => {
    const response = await openVsxRoute(
      new Request(`https://kiko.test/api/open-vsx?url=${encodeURIComponent("https://example.com/api/x")}`, {
        headers: { authorization: `Bearer ${await signToken("s", "owner", "session")}` },
      }),
      env,
    )
    expect(response?.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a caller with no session", async () => {
    const response = await openVsxRoute(
      new Request(`https://kiko.test/api/open-vsx?url=${encodeURIComponent(TARGET)}`),
      env,
    )
    expect(response?.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a body that redirected off Open VSX", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      url: "https://example.com/api/foo/bar",
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: new TextEncoder().encode("<p>elsewhere</p>"),
      truncated: false,
    })
    const response = await openVsxRoute(await request(), env)
    expect(response?.status).toBe(502)
  })
})
