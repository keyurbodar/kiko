import { describe, expect, test } from "bun:test"
import { route } from "../src/router"

// A stream body lets the test count how many times the route pulls it, so a body the route
// refuses on size alone is provably never read. highWaterMark 0 stops the runtime from
// buffering a chunk up front, which would otherwise look like a read.
function countedBody(total: number, chunkBytes = 100_000): { body: ReadableStream<Uint8Array>; pulled: () => number } {
  const chunks = Math.ceil(total / chunkBytes)
  let pulled = 0
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled >= chunks) {
          controller.close()
          return
        }
        pulled++
        controller.enqueue(new Uint8Array(Math.min(chunkBytes, total - (pulled - 1) * chunkBytes)))
      },
    },
    { highWaterMark: 0 },
  )
  return { body, pulled: () => pulled }
}

function post(url: string, body: ReadableStream<Uint8Array>, headers: Record<string, string>): Request {
  return new Request(url, { method: "POST", headers, body, duplex: "half" } as RequestInit)
}

const JSON_HEADERS = { "content-type": "application/json" }
const lookup = async () => null

describe("the request body cap", () => {
  test("a 2 mb body with a content-length header is refused without being read", async () => {
    const { body, pulled } = countedBody(2_000_000)
    const request = post("http://yuki.test/api/ws/user", body, { ...JSON_HEADERS, "content-length": "2000000" })
    const response = await route(request, {} as never, lookup)
    expect(response?.status).toBe(413)
    expect(pulled()).toBe(0)
  })

  test("a body over the cap with no content-length header is refused too", async () => {
    const { body } = countedBody(1_500_000)
    const request = post("http://yuki.test/api/ws/user", body, JSON_HEADERS)
    const response = await route(request, {} as never, lookup)
    expect(response?.status).toBe(413)
  })

  test("a small body that carries a user id key is still refused with 400", async () => {
    const request = new Request("http://yuki.test/api/ws/user", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ userId: "u1" }),
    })
    expect((await route(request, {} as never, lookup))?.status).toBe(400)
  })
})
