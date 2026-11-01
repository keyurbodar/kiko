import { describe, expect, it } from "@effect/vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Deadline } from "./deadline"
import { startDriver, type Driver, type Scheduler } from "./driver"
import { Fail } from "./log"

type Request = { id: number; method: string; params?: unknown }
type Reply = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }
type Handler = (request: Request) => Reply | undefined

const STATUS = {
  version: "1.0.0",
  os: "linux",
  session: "x11",
  permissions: { accessibility: "granted", screen: "granted", automation: "not_needed" },
  browsers: [{ name: "chrome", state: "connected" }],
} as const

const DENIED = {
  ...STATUS,
  permissions: { ...STATUS.permissions, accessibility: "denied" },
} as const

const quiet = () => ({ info() {}, warn() {}, error() {} })

const deadline = () => new Deadline(5_000)

const PIPE = "\\\\.\\pipe\\"

function address(dir: string): string {
  if (process.platform === "win32") return `${PIPE}kiko-driver-${process.pid}-${crypto.randomUUID()}`
  return join(dir, "driver.sock")
}

async function fakeDriver(handler: Handler) {
  const dir = await mkdtemp(join(tmpdir(), "kiko-driver-"))
  const sockets: Socket[] = []
  const waiting: (() => void)[] = []
  const server = createServer((socket) => {
    sockets.push(socket)
    socket.setEncoding("utf8")
    let buffer = ""
    socket.on("data", (chunk: string) => {
      buffer += chunk
      let index = buffer.indexOf("\n")
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        const request = JSON.parse(line) as Request
        const reply = handler(request)
        if (reply) socket.write(`${JSON.stringify({ id: request.id, ...reply })}\n`)
        index = buffer.indexOf("\n")
      }
    })
    for (const resolve of waiting.splice(0)) resolve()
  })
  const listening = address(dir)
  await new Promise<void>((resolve) => server.listen(listening, resolve))
  return {
    path: listening.startsWith(PIPE) ? listening.slice(PIPE.length) : listening,
    sockets,
    next: () => new Promise<void>((resolve) => waiting.push(resolve)),
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    },
  }
}

function manual() {
  const afters: (() => void)[] = []
  const repeats: (() => void)[] = []
  const scheduler: Scheduler = {
    after: (_ms, run) => {
      afters.push(run)
      return () => {
        const at = afters.indexOf(run)
        if (at >= 0) afters.splice(at, 1)
      }
    },
    repeat: (_ms, run) => {
      repeats.push(run)
      return () => {
        const at = repeats.indexOf(run)
        if (at >= 0) repeats.splice(at, 1)
      }
    },
  }
  return {
    scheduler,
    fireAfter: () => afters.shift()?.(),
    fireRepeat: () => [...repeats].forEach((run) => run()),
    scheduled: () => afters.length,
    repeating: () => repeats.length,
  }
}

function watcher() {
  const waiters: { when: () => boolean; resolve: () => void }[] = []
  const notify = () => {
    for (const waiter of waiters.slice()) {
      if (!waiter.when()) continue
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve()
    }
  }
  const until = (when: () => boolean) =>
    new Promise<void>((resolve) => {
      if (when()) return resolve()
      waiters.push({ when, resolve })
    })
  return { notify, until }
}

describe("driver client", () => {
  it("sends a call to the driver and returns its value", async () => {
    const requests: Request[] = []
    const fake = await fakeDriver((request) => {
      requests.push(request)
      return request.method === "status" ? { ok: true, value: STATUS } : { ok: true, value: [{ id: "w-1" }] }
    })
    const changes = watcher()
    let driver: Driver | null = null
    try {
      driver = startDriver({ path: fake.path, log: quiet(), scheduler: manual().scheduler, onChange: changes.notify })
      await changes.until(() => driver?.state() !== null)

      const value = await driver.call({ method: "windows" }, deadline())

      expect(value).toEqual([{ id: "w-1" }])
      expect(requests.find((request) => request.method === "windows")).toEqual({ id: 2, method: "windows" })
    } finally {
      driver?.close()
      await fake.close()
    }
  })

  it("maps a background_unavailable error to unsupported with the prefix", async () => {
    const fake = await fakeDriver((request) =>
      request.method === "status"
        ? { ok: true, value: STATUS }
        : { ok: false, error: { code: "background_unavailable", message: "the window is covered" } },
    )
    const changes = watcher()
    let driver: Driver | null = null
    try {
      driver = startDriver({ path: fake.path, log: quiet(), scheduler: manual().scheduler, onChange: changes.notify })
      await changes.until(() => driver?.state() !== null)

      const failure = await driver
        .call({ method: "act", params: { window: "w-1", action: "press", ref: 4 } }, deadline())
        .catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(Fail)
      expect((failure as Fail).code).toBe("unsupported")
      expect((failure as Fail).message).toBe("background_unavailable: the window is covered")
    } finally {
      driver?.close()
      await fake.close()
    }
  })

  it("reports background work only when accessibility is granted", async () => {
    const fake = await fakeDriver((request) => ({
      ok: true,
      value: request.method === "status" ? DENIED : [],
    }))
    const changes = watcher()
    let driver: Driver | null = null
    try {
      driver = startDriver({ path: fake.path, log: quiet(), scheduler: manual().scheduler, onChange: changes.notify })
      await changes.until(() => driver?.state() !== null)

      expect(driver.background()).toBe(false)
      expect(driver.browser()).toBe(true)
    } finally {
      driver?.close()
      await fake.close()
    }
  })

  it("reconnects after the driver socket drops", async () => {
    const timers = manual()
    const fake = await fakeDriver((request) => ({
      ok: true,
      value: request.method === "status" ? STATUS : [],
    }))
    const changes = watcher()
    let driver: Driver | null = null
    try {
      driver = startDriver({ path: fake.path, log: quiet(), scheduler: timers.scheduler, onChange: changes.notify })
      await changes.until(() => driver?.state() !== null)

      const again = fake.next()
      fake.sockets[0]?.destroy()
      await changes.until(() => timers.scheduled() === 1)
      timers.fireAfter()
      await again
      await changes.until(() => driver?.state() !== null)

      expect(await driver.call({ method: "windows" }, deadline())).toEqual([])
    } finally {
      driver?.close()
      await fake.close()
    }
  })

  it("stops asking for status once every permission is granted", async () => {
    const timers = manual()
    const fake = await fakeDriver((request) => ({
      ok: true,
      value: request.method === "status" ? STATUS : [],
    }))
    const changes = watcher()
    let driver: Driver | null = null
    try {
      driver = startDriver({ path: fake.path, log: quiet(), scheduler: timers.scheduler, onChange: changes.notify })
      await changes.until(() => driver?.state() !== null)

      expect(timers.repeating()).toBe(0)
    } finally {
      driver?.close()
      await fake.close()
    }
  })

  it("keeps asking for status while a permission is missing, then stops", async () => {
    const timers = manual()
    let granted = false
    const fake = await fakeDriver((request) => ({
      ok: true,
      value: request.method === "status" ? (granted ? STATUS : DENIED) : [],
    }))
    const changes = watcher()
    let driver: Driver | null = null
    try {
      driver = startDriver({ path: fake.path, log: quiet(), scheduler: timers.scheduler, onChange: changes.notify })
      await changes.until(() => driver?.state() !== null)
      expect(timers.repeating()).toBe(1)

      granted = true
      timers.fireRepeat()
      await changes.until(() => driver?.background() === true)

      expect(timers.repeating()).toBe(0)
    } finally {
      driver?.close()
      await fake.close()
    }
  })
})
