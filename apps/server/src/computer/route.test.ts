import { describe, expect, it } from "vitest"
import { CONNECT_HEADERS } from "@kiko/computer/sign"
import type { Env } from "../index"
import { computerRoute } from "./route"

const CONNECT = "https://kiko.example/api/pc/connect"
const PROTOCOL = "1"

function env(touched: () => void): Env {
  return {
    OWNER: {
      idFromName: (name: string) => name,
      get: () => {
        touched()
        return { fetch: async () => new Response("forwarded", { status: 200 }) }
      },
    },
    CREDENTIALS_KEK: "kek",
  } as unknown as Env
}

const connect = (headers: Record<string, string>) =>
  new Request(CONNECT, {
    headers: {
      upgrade: "websocket",
      [CONNECT_HEADERS.user]: "owner",
      [CONNECT_HEADERS.protocol]: PROTOCOL,
      ...headers,
    },
  })

describe("computer connect", () => {
  it("refuses a socket with no pairing signature, before reaching the owner", async () => {
    let reached = false
    const response = await computerRoute(
      connect({}),
      env(() => {
        reached = true
      }),
    )
    expect(response?.status).toBe(401)
    expect(reached).toBe(false)
  })

  it("forwards a signed socket to the owner", async () => {
    let reached = false
    const response = await computerRoute(
      connect({ [CONNECT_HEADERS.id]: "pc1", [CONNECT_HEADERS.ts]: "1", [CONNECT_HEADERS.sig]: "sig" }),
      env(() => {
        reached = true
      }),
    )
    expect(response?.status).toBe(200)
    expect(reached).toBe(true)
  })
})
