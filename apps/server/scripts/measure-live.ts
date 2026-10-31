import { randomBytes } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser, type Page } from "playwright"
import { mintPairCode } from "../src/computer/pairing"

const SERVER_PORT = 8899
const WEB_PORT = 5174
const SCREEN_PORT = 5199
const SWEEP_MS = 2_000
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
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  void (async () => {
    for await (const chunk of proc.stdout) process.stderr.write(`[${name}] ${new TextDecoder().decode(chunk)}`)
  })()
  void (async () => {
    for await (const chunk of proc.stderr) process.stderr.write(`[${name}] ${new TextDecoder().decode(chunk)}`)
  })()
  return proc
}

function stop(proc: Child): void {
  try {
    proc.kill()
  } catch {}
}

const SCREEN_HTML = `<!doctype html><meta charset="utf-8">
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden}
#line{position:absolute;top:0;bottom:0;width:12px;background:#fff}
#flash{position:absolute;width:96px;height:96px;background:#fff;display:none}
</style>
<div id="line"></div><div id="flash"></div>
<script>
window.__events = []
const line = document.getElementById("line"), flash = document.getElementById("flash")
const width = innerWidth
function tick(){ line.style.left = ((Date.now() % ${SWEEP_MS}) / ${SWEEP_MS}) * width + "px"; requestAnimationFrame(tick) }
tick()
addEventListener("pointerdown", (event) => {
  window.__events.push({ t: Date.now(), x: event.clientX / innerWidth, y: event.clientY / innerHeight })
  flash.style.left = event.clientX - 48 + "px"
  flash.style.top = event.clientY - 48 + "px"
  flash.style.display = "block"
  setTimeout(() => (flash.style.display = "none"), 200)
})
</script>`

type Sample = { glass: number; x: number }

const MEASURE_GLASS = async ([path, durationMs]: [string, number]) => {
  const screen = document.querySelector('[data-component="computer-screen"]')
  if (!screen) return []
  const video = screen.querySelector("video") as HTMLVideoElement | null
  const canvas = screen.querySelector("canvas") as HTMLCanvasElement | null
  const source: HTMLVideoElement | HTMLCanvasElement | null = path === "relay" ? canvas : video
  if (!source) return []
  const probe = document.createElement("canvas")
  probe.width = 480
  probe.height = 270
  const context = probe.getContext("2d", { willReadFrequently: true })
  if (!context) return []
  const samples: Sample[] = []
  const end = performance.now() + durationMs
  while (performance.now() < end) {
    try {
      context.drawImage(source, 0, 0, probe.width, probe.height)
      const row = context.getImageData(0, 80, probe.width, 1).data
      let best = -1
      let value = 0
      for (let x = 0; x < probe.width; x++) {
        const v = row[x * 4] ?? 0
        if (v > value) {
          value = v
          best = x
        }
      }
      if (value > 180 && best > 4 && best < probe.width - 5) {
        const fraction = best / probe.width
        const glass = (Date.now() - fraction * 2000) % 2000
        if (glass < 1200) samples.push({ glass, x: fraction })
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  return samples
}

const MEASURE_PHOTON = async ([path, x, y, timeoutMs]: [string, number, number, number]) => {
  const screen = document.querySelector('[data-component="computer-screen"]')
  if (!screen) return null
  const video = screen.querySelector("video") as HTMLVideoElement | null
  const canvas = screen.querySelector("canvas") as HTMLCanvasElement | null
  const source: HTMLVideoElement | HTMLCanvasElement | null = path === "relay" ? canvas : video
  if (!source) return null
  const width = (source as HTMLVideoElement).videoWidth || (source as HTMLCanvasElement).width
  const height = (source as HTMLVideoElement).videoHeight || (source as HTMLCanvasElement).height
  const probe = document.createElement("canvas")
  probe.width = 32
  probe.height = 32
  const context = probe.getContext("2d", { willReadFrequently: true })
  if (!context) return null
  const px = Math.max(0, Math.round(x * width) - 16)
  const py = Math.max(0, Math.round(y * height) - 16)
  const end = performance.now() + timeoutMs
  while (performance.now() < end) {
    try {
      context.drawImage(source, px, py, 32, 32, 0, 0, 32, 32)
      const block = context.getImageData(0, 0, 32, 32).data
      let sum = 0
      for (let i = 0; i < block.length; i += 4) sum += block[i] ?? 0
      if (sum / (block.length / 4) > 200) return Date.now()
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 8))
  }
  return null
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

function fakeDriver(path: string) {
  const server = createServer((socket) => {
    socket.setEncoding("utf8")
    let buffer = ""
    socket.on("data", (chunk: string) => {
      buffer += chunk
      let at = buffer.indexOf("\n")
      while (at >= 0) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 1)
        at = buffer.indexOf("\n")
        let request: { id: number; method: string }
        try {
          request = JSON.parse(line) as { id: number; method: string }
        } catch {
          continue
        }
        const value =
          request.method === "status"
            ? {
                version: "test",
                os: "linux",
                session: "x11",
                permissions: { accessibility: "granted", screen: "granted", automation: "not_needed" },
                browsers: [],
                displays: [{ id: "primary", width: 1920, height: 1080, scale: 1 }],
              }
            : { version: "test", tools: [{ name: "screenshot" }] }
        socket.write(`${JSON.stringify({ id: request.id, ok: true, value })}\n`)
      }
    })
  })
  return new Promise<ReturnType<typeof createServer>>((resolve) => server.listen(path, () => resolve(server)))
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "kiko-live-"))
  const children: Child[] = []
  const kek = randomBytes(32).toString("base64")
  const secret = randomBytes(32).toString("hex")
  const display = process.env.DISPLAY ?? ":99"
  let driver: Awaited<ReturnType<typeof fakeDriver>> | null = null
  let remote: Browser | null = null
  let viewer: Browser | null = null
  try {
    const driverPath = join(dir, "driver.sock")
    driver = await fakeDriver(driverPath)

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
      for (const host of ["localhost", "127.0.0.1"]) {
        const ok = await fetch(`http://${host}:${WEB_PORT}/`)
          .then((answer) => answer.ok)
          .catch(() => false)
        if (ok) return true
      }
      return false
    })

    const screen = Bun.serve({
      port: SCREEN_PORT,
      fetch: () => new Response(SCREEN_HTML, { headers: { "content-type": "text/html" } }),
    })

    remote = await chromium.launch({
      headless: false,
      args: ["--kiosk", "--window-position=0,0", "--window-size=1920,1080", "--no-sandbox", "--disable-gpu"],
      env: { ...process.env, DISPLAY: display },
    })
    const screenPage = await remote.newPage()
    await screenPage.goto(`http://127.0.0.1:${SCREEN_PORT}/`)
    await wait(1_500)

    const session = (await (
      await fetch(`http://127.0.0.1:${SERVER_PORT}/api/auth/dev/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${SERVER_PORT}` },
        body: JSON.stringify({ name: "owner" }),
      })
    ).json()) as { token: string }

    const minted = await mintPairCode(kek, "owner")
    const computerDir = join(dir, "pc")
    const env = { KIKO_COMPUTER_DIR: computerDir, KIKO_DRIVER: driverPath, DISPLAY: display }
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

    viewer = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
    })

    const shots = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : undefined
    if (shots) await mkdir(shots, { recursive: true })
    const noRtc = process.argv.includes("--no-rtc")

    const newViewer = async () => {
      const context = await viewer.newContext()
      if (noRtc)
        await context.addInitScript(() => {
          const Broken = function () {
            throw new Error("RTC is off for this measurement")
          }
          Object.defineProperty(window, "RTCPeerConnection", { value: Broken, configurable: true })
        })
      await context.addInitScript((record) => {
        localStorage.setItem("kiko:auth", record)
        localStorage.setItem("kiko:schema", "1")
      }, auth)
      const page = await context.newPage()
      try {
        await page.goto(`http://localhost:${WEB_PORT}/`)
        await page.waitForSelector('[data-action="computer-watch"], [data-action="skip-first-run"]', {
          timeout: 60_000,
        })
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
        await page
          .waitForSelector('[data-component="first-run"]', { state: "detached", timeout: 30_000 })
          .catch(() => {})
      } catch (error) {
        if (shots) {
          await page.screenshot({ path: join(shots, "failure.png") }).catch(() => {})
          await writeFile(join(shots, "failure.html"), await page.content()).catch(() => {})
        }
        throw error
      }
      await wait(1_500)
      return { context, page }
    }

    const mode = (page: Page) =>
      page.evaluate(
        () => document.querySelector('[data-component="computer-screen"]')?.getAttribute("data-mode") ?? "unknown",
      )
    const open = async (page: Page) => {
      const opened = Date.now()
      await page.click('[data-action="computer-watch"]')
      await page.waitForSelector('[data-component="computer-screen"]', { timeout: 30_000 })
      await page.waitForFunction(
        () => {
          const screen = document.querySelector('[data-component="computer-screen"]')
          const value = screen?.getAttribute("data-mode")
          return value === "rtc" || value === "relay"
        },
        { timeout: 30_000 },
      )
      return { openMs: Date.now() - opened, mode: await mode(page) }
    }
    const close = async (page: Page) => {
      const hide = page.locator('[data-action="computer-hide"]')
      if ((await hide.count()) > 0) await hide.click()
      await page.waitForSelector('[data-component="computer-screen"]', { state: "detached", timeout: 15_000 })
      await wait(800)
    }

    const colds: number[] = []
    for (let round = 0; round < 5; round++) {
      const fresh = await newViewer()
      colds.push((await open(fresh.page)).openMs)
      await fresh.context.close()
    }

    const { context, page } = await newViewer()
    const cold = await open(page)

    const takeover = page.locator('[data-action="computer-takeover"]')
    if ((await takeover.count()) > 0) {
      await takeover.click()
      await page.waitForSelector('[data-component="computer-screen"][data-interactive]', { timeout: 15_000 })
      await wait(500)
    }

    const path = (await mode(page)) === "relay" ? "relay" : "rtc"
    const glass = await page.evaluate(MEASURE_GLASS, [path, 4_000])
    if (shots) await page.screenshot({ path: join(shots, `cold-${path}.png`) }).catch(() => {})

    const box = await page.locator('[data-part="stage"]').boundingBox()
    const clicks: number[] = []
    if (box) {
      for (let round = 0; round < 5; round++) {
        const before = await screenPage.evaluate(() => (window as unknown as { __events: unknown[] }).__events.length)
        const sampling = page.evaluate(MEASURE_PHOTON, [path, 0.5, 0.5, 2_000])
        await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
        const landed = await until(
          "the remote click",
          async () =>
            (await screenPage.evaluate(() => (window as unknown as { __events: unknown[] }).__events.length)) > before,
          3_000,
        )
          .then(() => true)
          .catch(() => false)
        const photon = await sampling
        if (landed && typeof photon === "number") {
          const event = (await screenPage.evaluate(() =>
            (window as unknown as { __events: { t: number }[] }).__events.at(-1),
          )) as { t: number }
          clicks.push(photon - event.t)
        }
        await wait(500)
      }
    }

    await close(page)
    const warm: number[] = []
    for (let round = 0; round < 4; round++) {
      const again = await open(page)
      warm.push(again.openMs)
      await wait(500)
      await close(page)
    }
    await context.close()

    const coldOpen = summary(colds)
    const warmOpen = { ...summary(warm), n: warm.length }
    const output = {
      at: new Date().toISOString(),
      cold: { ...cold, glass: summary(glass.map((sample) => sample.glass)), input: summary(clicks) },
      warm: warmOpen,
      open: { cold: coldOpen, warm: warmOpen },
      path,
    }
    const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined
    if (out) await writeFile(out, `${JSON.stringify(output, null, 2)}\n`)
    console.log(JSON.stringify(output, null, 2))
    screen.stop(true)
  } finally {
    viewer?.close().catch(() => {})
    remote?.close().catch(() => {})
    driver?.close()
    for (const child of children) stop(child)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

await main()
