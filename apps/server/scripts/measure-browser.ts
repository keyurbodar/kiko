import { randomBytes } from "node:crypto"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { connect, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser, type Page } from "playwright"
import { mintPairCode } from "../src/computer/pairing"

const SERVER_PORT = 8899
const WEB_PORT = 5174
const FIXTURE_PORT = 5199
const ROOT = join(import.meta.dirname, "..", "..", "..")
const SERVER = join(ROOT, "apps", "server")
const COMPUTER = join(ROOT, "apps", "computer")
const WEB = join(ROOT, "apps", "web-solid")

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(what: string, check: () => Promise<boolean> | boolean, ms = 60_000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check().catch(() => false)) return
    await wait(250)
  }
  throw new Error(`timed out waiting for ${what}`)
}

type Child = ReturnType<typeof Bun.spawn>

function start(name: string, cmd: string[], cwd: string, env: Record<string, string> = {}): Child {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" })
  for (const stream of [proc.stdout, proc.stderr])
    void (async () => {
      for await (const chunk of stream) process.stderr.write(`[${name}] ${new TextDecoder().decode(chunk)}`)
    })()
  return proc
}

function stop(proc: Child): void {
  try {
    proc.kill()
  } catch {}
}

type Driver = {
  call(method: string, params?: unknown): Promise<unknown>
  close(): void
}

type Reply = { id?: number; ok?: boolean; value?: unknown; error?: { message?: string } }

function connectDriver(path: string): Promise<Driver> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(path)
    socket.setEncoding("utf8")
    let buffer = ""
    let nextId = 1
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
    const failAll = (error: Error) => {
      for (const one of pending.values()) one.reject(error)
      pending.clear()
    }
    socket.on("error", failAll)
    socket.on("close", () => failAll(new Error("the kiko driver socket closed")))
    socket.on("data", (chunk: string) => {
      buffer += chunk
      let at = buffer.indexOf("\n")
      while (at >= 0) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 1)
        at = buffer.indexOf("\n")
        let reply: Reply
        try {
          reply = JSON.parse(line) as Reply
        } catch {
          continue
        }
        if (typeof reply.id !== "number") continue
        const one = pending.get(reply.id)
        if (!one) continue
        pending.delete(reply.id)
        if (reply.ok === true) one.resolve(reply.value)
        else one.reject(new Error(reply.error?.message ?? "the kiko driver failed the call"))
      }
    })
    socket.once("connect", () => {
      socket.removeListener("error", reject)
      resolve({
        call(method, params) {
          const id = nextId++
          const line = JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })
          return new Promise((done, failed) => {
            const timer = setTimeout(() => {
              pending.delete(id)
              failed(new Error(`${method} timed out`))
            }, 120_000)
            pending.set(id, {
              resolve: (value) => {
                clearTimeout(timer)
                done(value)
              },
              reject: (error) => {
                clearTimeout(timer)
                failed(error)
              },
            })
            socket.write(`${line}\n`)
          })
        },
        close() {
          socket.end()
        },
      })
    })
    socket.once("error", reject)
  })
}

const FIXTURE_HTML = `<!doctype html><meta charset="utf-8">
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden;font:32px sans-serif}
#field{position:absolute;left:0;top:0;width:70%;height:12%;background:#111;color:#fff;border:0;padding:0 12px}
#flash{position:absolute;width:120px;height:120px;background:#fff;display:none;pointer-events:none}
</style>
<input id="field" autocomplete="off" spellcheck="false">
<div id="flash"></div>
<script>
window.__clicks = 0
const flash = document.getElementById("flash")
addEventListener("pointerdown", (event) => {
  window.__clicks += 1
  flash.style.left = event.clientX - 60 + "px"
  flash.style.top = event.clientY - 60 + "px"
  flash.style.display = "block"
  setTimeout(() => (flash.style.display = "none"), 600)
})
document.getElementById("field").focus()
</script>`

const RECORD_FRAMES = () => {
  const store = window as unknown as { __frames: number[]; __click: number }
  store.__frames = []
  store.__click = 0
  const add = WebSocket.prototype.addEventListener
  WebSocket.prototype.addEventListener = function (
    this: WebSocket,
    type: string,
    listener: EventListener,
    options?: unknown,
  ) {
    if (type !== "message") return add.call(this, type, listener, options as AddEventListenerOptions)
    const wrapped = (event: Event) => {
      if ((event as MessageEvent).data instanceof ArrayBuffer) store.__frames.push(performance.now())
      return (listener as EventListener).call(this, event)
    }
    return add.call(this, type, wrapped, options as AddEventListenerOptions)
  }
  addEventListener(
    "pointerdown",
    () => {
      store.__click = performance.now()
    },
    true,
  )
}

const MEASURE_STATE = () => {
  const store = window as unknown as { __frames: number[]; __click: number }
  return { click: store.__click, frames: [...store.__frames] }
}

function percentile(values: readonly number[], p: number): number {
  if (!values.length) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))] ?? Number.NaN
}

function summary(values: readonly number[]) {
  const round = (value: number) => (Number.isFinite(value) ? Math.round(value) : null)
  return {
    n: values.length,
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    min: values.length ? round(Math.min(...values)) : null,
    max: values.length ? round(Math.max(...values)) : null,
  }
}

async function command(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" })
  const output = await new Response(proc.stdout).text()
  await proc.exited
  return output.trim()
}

async function frontWindow(): Promise<string | null> {
  return (await command(["xdotool", "getactivewindow", "getwindowname"]).catch(() => "")) || null
}

async function chromeWindows(): Promise<number> {
  const found = await command(["xdotool", "search", "--class", "chromium"]).catch(() => "")
  return found ? found.split("\n").filter(Boolean).length : 0
}

type Meter = {
  counters: Record<string, number>
  billedWrites?: { total: number }
  statements?: { sql: string; rowsWritten: number }[]
}

function billableWrites(meter: Meter): number {
  if (meter.billedWrites) return meter.billedWrites.total
  const counters = meter.counters
  const sum = (matches: (key: string) => boolean) =>
    Object.entries(counters).reduce((total, [key, value]) => (matches(key) ? total + value : total), 0)
  return (
    (counters["owner.rowsWritten"] ?? sum((key) => key.endsWith(".rowsWritten"))) +
    sum((key) => key.endsWith(".kvKeysPut")) +
    sum((key) => key.endsWith(".kvKeysDeleted")) +
    sum((key) => key.endsWith(".alarmWrites"))
  )
}

type Reading = { total: number; statements: Record<string, number> }

async function meter(token: string): Promise<Reading> {
  const answer = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/dev/stats`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!answer.ok) throw new Error(`the stats endpoint answered ${answer.status}`)
  const body = (await answer.json()) as Meter
  const statements: Record<string, number> = {}
  for (const row of body.statements ?? [])
    if (row.rowsWritten > 0) statements[row.sql] = (statements[row.sql] ?? 0) + row.rowsWritten
  return { total: billableWrites(body), statements }
}

function wrote(from: Reading, to: Reading): { rows: number; statements: Record<string, number> } {
  const statements: Record<string, number> = {}
  for (const [sql, rows] of Object.entries(to.statements)) {
    const added = rows - (from.statements[sql] ?? 0)
    if (added > 0) statements[sql.slice(0, 200)] = added
  }
  return { rows: to.total - from.total, statements }
}

async function main(): Promise<void> {
  const kiko = process.env.KIKO_BIN
  const browser = process.env.KIKO_AGENT_BROWSER
  if (!kiko) throw new Error("KIKO_BIN is not set")
  if (!browser) throw new Error("KIKO_AGENT_BROWSER is not set")
  const dir = await mkdtemp(join(tmpdir(), "kiko-browser-live-"))
  const children: Child[] = []
  const kek = randomBytes(32).toString("base64")
  const secret = randomBytes(32).toString("hex")
  const app = join(dir, "app")
  let driver: Driver | null = null
  let viewer: Browser | null = null
  try {
    await mkdir(app, { recursive: true })
    const stub = join(dir, "core-stub.sh")
    await writeFile(stub, "#!/bin/sh\nsleep 3600\n")
    await chmod(stub, 0o755)

    children.push(
      start(
        "worker",
        [
          "bunx",
          "wrangler",
          "dev",
          "--port",
          String(SERVER_PORT),
          "--ip",
          "127.0.0.1",
          "--var",
          `CREDENTIALS_KEK:${kek}`,
          "--var",
          `SESSION_SECRET:${secret}`,
          "--persist-to",
          join(dir, "state"),
        ],
        SERVER,
      ),
    )
    await until("the worker", async () => (await fetch(`http://127.0.0.1:${SERVER_PORT}/api/health`)).ok)

    children.push(
      start("web", ["bunx", "vite", "--port", String(WEB_PORT), "--strictPort"], WEB, {
        KIKO_SERVER_PORT: String(SERVER_PORT),
      }),
    )
    await until("the web app", async () => {
      for (const host of ["localhost", "127.0.0.1"])
        if (
          await fetch(`http://${host}:${WEB_PORT}/`)
            .then((answer) => answer.ok)
            .catch(() => false)
        )
          return true
      return false
    })

    const fixture = Bun.serve({
      port: FIXTURE_PORT,
      fetch: () => new Response(FIXTURE_HTML, { headers: { "content-type": "text/html" } }),
    })

    children.push(
      start("kiko", [kiko], app, {
        KIKO_APP_DIR: app,
        KIKO_COMPUTER_DIR: join(app, "computer"),
        KIKO_CORE: stub,
        KIKO_AGENT_BROWSER: browser,
      }),
    )

    const socketPath = join(app, "driver.sock")
    await until("the driver socket", async () => {
      if (driver) return true
      driver = await connectDriver(socketPath).catch(() => null)
      return driver !== null
    })
    await until(
      "the browser engine",
      async () => {
        const status = (await driver?.call("status")) as { browsers?: { state?: string }[] } | undefined
        return (status?.browsers ?? []).some((one) => one.state === "connected")
      },
      120_000,
    )

    const frontBefore = await frontWindow()
    const tab = (await driver?.call("browser.open", {
      url: `http://127.0.0.1:${FIXTURE_PORT}/`,
      mode: "background",
    })) as { id: string }

    const session = (await (
      await fetch(`http://127.0.0.1:${SERVER_PORT}/api/auth/dev/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${SERVER_PORT}` },
        body: JSON.stringify({ name: "owner" }),
      })
    ).json()) as { token: string }

    const minted = await mintPairCode(kek, "owner")
    const computerDir = join(app, "computer")
    const env = { KIKO_COMPUTER_DIR: computerDir, KIKO_DRIVER: socketPath }
    const paired = start(
      "pair",
      ["bun", "src/index.ts", "pair", `http://127.0.0.1:${SERVER_PORT}#${minted.code}`],
      COMPUTER,
      env,
    )
    const code = await paired.exited
    if (code !== 0) throw new Error(`the daemon failed to pair (exit ${code})`)
    children.push(start("daemon", ["bun", "src/index.ts", "run"], COMPUTER, env))

    const auth = JSON.stringify({
      v: 1,
      identity: { clerkUserId: null, email: "owner@example.com" },
      backend: { url: `http://localhost:${WEB_PORT}`, key: "measure" },
      user: { id: "owner", name: "owner" },
      token: session.token,
    })

    viewer = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
    const context = await viewer.newContext()
    await context.addInitScript(RECORD_FRAMES)
    await context.addInitScript((record) => {
      localStorage.setItem("kiko:auth", record)
      localStorage.setItem("kiko:schema", "1")
    }, auth)
    const page = await context.newPage()
    const shots = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : undefined
    if (shots) await mkdir(shots, { recursive: true })

    try {
      await page.goto(`http://localhost:${WEB_PORT}/`)
      await page.waitForSelector('[data-action="computer-watch"], [data-action="skip-first-run"]', { timeout: 60_000 })
      const skip = page.locator('[data-action="skip-first-run"]')
      if ((await skip.count()) > 0) await skip.click()
      await page
        .waitForSelector('[data-action="open-kiko"], [data-action="computer-watch"]', {
          state: "visible",
          timeout: 30_000,
        })
        .catch(() => {})
      const done = page.locator('[data-action="open-kiko"]')
      if ((await done.count()) > 0) await done.click()
      await page.waitForSelector('[data-action="computer-watch"]', { timeout: 60_000 })
      await page.waitForSelector('[data-component="first-run"]', { state: "detached", timeout: 30_000 }).catch(() => {})
    } catch (error) {
      if (shots) {
        await page.screenshot({ path: join(shots, "failure.png") }).catch(() => {})
        await writeFile(join(shots, "failure.html"), await page.content()).catch(() => {})
      }
      throw error
    }

    await wait(1_500)
    await page.click('[data-action="computer-watch"]')
    await page.waitForSelector('[data-action="computer-tab-browser"]', { timeout: 60_000 })

    await wait(3_000)
    const idle = await meter(session.token)
    const opened = Date.now()
    await page.click(`[data-action="computer-tab-browser"][data-browser-id="${tab.id}"]`)
    await page.waitForSelector('[data-component="computer-browser"]', { timeout: 30_000 })
    await page.waitForFunction(
      () =>
        (window as unknown as { __frames?: number[] }).__frames !== undefined &&
        (window as unknown as { __frames: number[] }).__frames.length > 0,
      { timeout: 30_000 },
    )
    const openMs = Date.now() - opened

    const streamed = await meter(session.token)

    const takeover = page.locator('[data-action="computer-takeover"]')
    if ((await takeover.count()) > 0) {
      await takeover.click()
      await page.waitForSelector('[data-component="computer-browser"][data-interactive]', { timeout: 15_000 })
      await wait(400)
    }

    const taken = await meter(session.token)

    const stage = await page.locator('[data-part="stage"]').boundingBox()
    if (!stage) throw new Error("the browser stage has no box")
    const x = stage.x + stage.width * 0.5
    const y = stage.y + stage.height * 0.5
    const frames: number[] = []
    const received: number[] = []
    const missed: unknown[] = []
    for (let round = 0; round < 5; round++) {
      await page.evaluate(() => {
        const store = window as unknown as { __click: number; __frames: number[] }
        store.__click = 0
        store.__frames.length = 0
      })
      await wait(700)
      await page.mouse.click(x, y)
      await wait(700)
      const sample = (await page.evaluate(MEASURE_STATE)) as { click: number; frames: number[] }
      const painted = sample.frames.find((at) => at >= sample.click)
      if (sample.click > 0 && painted !== undefined) frames.push(Math.round(painted - sample.click))
      else missed.push(sample)
      const landed = (await driver?.call("browser.eval", {
        tab: tab.id,
        expression: "window.__clicks||0",
      })) as number
      received.push(Number(landed))
    }

    const typeAt = await page.locator('[data-part="stage"]').boundingBox()
    if (!typeAt) throw new Error("the browser stage has no box")
    await page.mouse.click(typeAt.x + typeAt.width * 0.2, typeAt.y + typeAt.height * 0.06)
    await wait(300)
    await page.keyboard.type("hi")
    await wait(800)
    const typed = (await driver?.call("browser.eval", {
      tab: tab.id,
      expression: "document.getElementById('field').value",
    })) as string

    const frontAfter = await frontWindow()
    const chrome = await chromeWindows()
    const after = await meter(session.token)
    if (shots) {
      await page.mouse.click(x, y)
      await wait(120)
      await page.screenshot({ path: join(shots, "browser-tab.png") }).catch(() => {})
    }

    const output = {
      at: new Date().toISOString(),
      tab: tab.id,
      openMs,
      clickToFrame: summary(frames),
      received,
      missed,
      typing: { typed, ok: typed === "hi" },
      focus: { before: frontBefore, after: frontAfter, chrome, raised: frontBefore !== frontAfter || chrome > 0 },
      writes: {
        idle,
        streamed,
        taken,
        after,
        attachAndFrames: wrote(idle, streamed),
        takeover: wrote(streamed, taken),
        inputAndFrames: wrote(taken, after),
      },
    }
    const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined
    if (out) await writeFile(out, `${JSON.stringify(output, null, 2)}\n`)
    console.log(JSON.stringify(output, null, 2))
    fixture.stop(true)
  } finally {
    viewer?.close().catch(() => {})
    driver?.close()
    for (const child of children) stop(child)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

await main()
