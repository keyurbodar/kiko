import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CONNECT_HEADERS, connectMessage, generateKeys, sign } from "@kiko/computer/sign"
import { PROTOCOL } from "@kiko/computer/wire"
import type { Env } from "../index"
import { mintPairCode } from "./pairing"
import { computerRoute } from "./route"

const CONNECT = "https://kiko.example/api/pc/connect"
const PAIR = "https://kiko.example/api/pc/pair"
const NOW = 1_800_000_000_000

const HELLO = {
  t: "hello",
  protocol: PROTOCOL,
  version: "1.0.0",
  os: "linux",
  arch: "x64",
  host: "test",
  caps: { shell: true, files: true, desktop: false, live: false, input: false },
  displays: [],
}

function memoryCache() {
  const store = new Map<string, Response>()
  return {
    default: {
      match: async (request: Request) => store.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => {
        store.set(request.url, response.clone())
      },
      delete: async (request: Request) => store.delete(request.url),
    },
  }
}

function env(touched: () => void, status = 200): Env {
  return {
    OWNER: {
      idFromName: (name: string) => name,
      get: () => {
        touched()
        return {
          fetch: async () => new Response("forwarded", { status }),
          pcPair: async () => ({ ok: true, id: "pc1", name: "laptop" }),
        }
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
      [CONNECT_HEADERS.protocol]: String(PROTOCOL),
      ...headers,
    },
  })

const pair = (body: unknown) =>
  new Request(PAIR, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

function pairRequest(code: string, publicKey: string) {
  return { code, publicKey, name: "laptop", hello: HELLO }
}

async function pairComputer(env: Env, publicKey: string): Promise<void> {
  const { code } = await mintPairCode("kek", "owner")
  const response = await computerRoute(pair(pairRequest(code, publicKey)), env)
  expect(response?.status).toBe(200)
}

beforeEach(() => {
  vi.stubGlobal("caches", memoryCache())
})

afterEach(() => {
  vi.unstubAllGlobals()
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

  it("forwards an uncached socket to the owner", async () => {
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

  it("forwards a paired computer whose signature verifies", async () => {
    const keys = await generateKeys()
    let reached = 0
    const e = env(() => {
      reached += 1
    })
    await pairComputer(e, keys.publicKey)
    const before = reached
    const ts = NOW
    const sig = await sign(keys.privateKey, connectMessage("owner", "pc1", ts, PROTOCOL))
    const response = await computerRoute(
      connect({ [CONNECT_HEADERS.id]: "pc1", [CONNECT_HEADERS.ts]: String(ts), [CONNECT_HEADERS.sig]: sig }),
      e,
    )
    expect(response?.status).toBe(200)
    expect(reached).toBe(before + 1)
  })

  it("forgets a cached key that no longer verifies and lets the owner decide", async () => {
    const keys = await generateKeys()
    let reached = 0
    const e = env(() => {
      reached += 1
    }, 401)
    await pairComputer(e, keys.publicKey)
    const before = reached
    const response = await computerRoute(
      connect({ [CONNECT_HEADERS.id]: "pc1", [CONNECT_HEADERS.ts]: "1", [CONNECT_HEADERS.sig]: "sig" }),
      e,
    )
    expect(response?.status).toBe(401)
    expect(reached).toBe(before + 1)
  })

  it("stops forwarding an id the owner already rejected, and keeps its reason", async () => {
    let reached = 0
    const e = env(() => {
      reached += 1
    }, 410)
    const headers = { [CONNECT_HEADERS.id]: "gone", [CONNECT_HEADERS.ts]: "1", [CONNECT_HEADERS.sig]: "sig" }
    const first = await computerRoute(connect(headers), e)
    expect(first?.status).toBe(410)
    const second = await computerRoute(connect(headers), e)
    expect(second?.status).toBe(410)
    expect(reached).toBe(1)
  })

  it("stops waking the owner once it reports a paired computer gone", async () => {
    const keys = await generateKeys()
    let reached = 0
    const e = env(() => {
      reached += 1
    }, 410)
    await pairComputer(e, keys.publicKey)
    const before = reached
    const ts = NOW
    const headers = {
      [CONNECT_HEADERS.id]: "pc1",
      [CONNECT_HEADERS.ts]: String(ts),
      [CONNECT_HEADERS.sig]: await sign(keys.privateKey, connectMessage("owner", "pc1", ts, PROTOCOL)),
    }
    const first = await computerRoute(connect(headers), e)
    expect(first?.status).toBe(410)
    const second = await computerRoute(connect(headers), e)
    expect(second?.status).toBe(410)
    expect(reached).toBe(before + 1)
  })

  it("lets a computer that re-paired with a new key through the stale key cache", async () => {
    const stale = await generateKeys()
    const fresh = await generateKeys()
    let reached = 0
    const e = env(() => {
      reached += 1
    })
    await pairComputer(e, stale.publicKey)
    const before = reached
    const ts = NOW
    const headers = {
      [CONNECT_HEADERS.id]: "pc1",
      [CONNECT_HEADERS.ts]: String(ts),
      [CONNECT_HEADERS.sig]: await sign(fresh.privateKey, connectMessage("owner", "pc1", ts, PROTOCOL)),
    }

    const first = await computerRoute(connect(headers), e)
    const second = await computerRoute(connect(headers), e)

    expect(first?.status).toBe(200)
    expect(second?.status).toBe(200)
    expect(reached).toBe(before + 2)
  })

  it("stops waking the owner for uncached computers once the wake budget is spent", async () => {
    vi.resetModules()
    const { computerRoute: fresh } = await import("./route")
    let reached = 0
    const e = env(() => {
      reached += 1
    })
    for (let i = 0; i < 60; i++) {
      const response = await fresh(
        connect({ [CONNECT_HEADERS.id]: `pc${i}`, [CONNECT_HEADERS.ts]: "1", [CONNECT_HEADERS.sig]: "sig" }),
        e,
      )
      expect(response?.status).toBe(200)
    }
    const refused = await fresh(
      connect({ [CONNECT_HEADERS.id]: "pc-last", [CONNECT_HEADERS.ts]: "1", [CONNECT_HEADERS.sig]: "sig" }),
      e,
    )
    expect(refused?.status).toBe(429)
    expect(reached).toBe(60)
  })
})

describe("computer pair", () => {
  it("refuses a pairing code that does not exist, before reaching the owner", async () => {
    let reached = false
    const response = await computerRoute(
      pair(pairRequest("not-a-pairing-code", "public-key")),
      env(() => {
        reached = true
      }),
    )
    expect(response?.status).toBe(403)
    expect(reached).toBe(false)
  })

  it("refuses a body over the cap", async () => {
    const response = await computerRoute(
      new Request(PAIR, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(9_000),
      }),
      env(() => {}),
    )
    expect(response?.status).toBe(413)
  })
})
