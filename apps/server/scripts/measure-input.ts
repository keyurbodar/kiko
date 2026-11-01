import { randomBytes } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser, type Page } from "playwright"
import { mintPairCode } from "../src/computer/pairing"

const SERVER_PORT = 8899
const WEB_PORT = 5174
const LEFT_PORT = 5198
const RIGHT_PORT = 5197
const ROOT = join(import.meta.dirname, "..", "..", "..")
const SERVER = join(ROOT, "apps", "server")
const COMPUTER = join(ROOT, "apps", "computer")
const WEB = join(ROOT, "apps", "web-solid")
const TEXT = "Grüße, 世界 — deux lignes\nligne deux\n🎉 end"

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
  void (async () => {
    for await (const chunk of proc.stdout) process.stderr.write(`[${name}] ${new TextDecoder().decode(chunk)}`)
  })()
  void (async () => {
    for await (const chunk of proc.stderr) process.stderr.write(`[${name}] ${new TextDecoder().decode(chunk)}`)
  })()
  return proc
}

const PAGE = (name: string) => `<!doctype html><meta charset="utf-8">
<style>
html,body{margin:0;height:100%;background:#111;color:#eee;font:16px system-ui}
#field{position:absolute;left:20%;top:40%;width:60%;height:20%;font-size:20px}
</style>
<input id="field" autocomplete="off">
<script>
window.__name = ${JSON.stringify(name)}
window.__events = []
addEventListener("pointerdown", (event) => {
  window.__events.push({ t: Date.now(), x: event.clientX / innerWidth, y: event.clientY / innerHeight, screenX: event.screenX, screenY: event.screenY })
})
document.getElementById("field").focus()
</script>`

function fakeDriver(path: string) {
  const calls: { name?: string; args?: unknown }[] = []
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
        let request: { id: number; method: string; params?: { name?: string; args?: unknown } }
        try {
          request = JSON.parse(line) as typeof request
        } catch {
          continue
        }
        if (request.method === "desktop.call" && request.params?.name) {
          calls.push({ name: request.params.name, args: request.params.args })
        }
        const value = request.method === "status" ? status() : { version: "test", tools: [{ name: "screenshot" }] }
        socket.write(`${JSON.stringify({ id: request.id, ok: true, value })}\n`)
      }
    })
  })
  return { server, calls, ready: new Promise<void>((resolve) => server.listen(path, () => resolve())) }
}

async function command(args: string[]): Promise<string | null> {
  try {
    const child = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "ignore" })
    const out = new Response(child.stdout).text()
    return (await child.exited) === 0 ? await out : null
  } catch {
    return null
  }
}

const MAC_SCREEN =
  "ObjC.import('AppKit');const f=$.NSScreen.mainScreen.frame;JSON.stringify({width:f.size.width,height:f.size.height})"

async function screenSize(): Promise<{ width: number; height: number } | null> {
  if (process.platform === "darwin") {
    const out = await command(["osascript", "-l", "JavaScript", "-e", MAC_SCREEN])
    if (!out) return null
    const parsed = JSON.parse(out.trim()) as { width?: number; height?: number }
    if (typeof parsed.width !== "number" || typeof parsed.height !== "number") return null
    return { width: Math.round(parsed.width), height: Math.round(parsed.height) }
  }
  const out = await command(["xrandr", "--query"])
  const match = out ? /current (\d+) x (\d+)/.exec(out) : null
  if (!match?.[1] || !match[2]) return null
  return { width: Number(match[1]), height: Number(match[2]) }
}

function status() {
  return {
    version: "test",
    os: "linux",
    session: "x11",
    permissions: { accessibility: "granted", screen: "granted", automation: "not_needed" },
    browsers: [],
    displays: [],
  }
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "kiko-input-"))
  const children: Child[] = []
  const kek = randomBytes(32).toString("base64")
  const secret = randomBytes(32).toString("hex")
  const display = process.env.DISPLAY ?? ":99"
  let driver: ReturnType<typeof fakeDriver> | null = null
  const browsers: Browser[] = []
  const result: Record<string, unknown> = { text: TEXT }
  let failed = false
  try {
    const driverPath = join(dir, "driver.sock")
    driver = fakeDriver(driverPath)
    await driver.ready

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
        if (
          await fetch(`http://${host}:${WEB_PORT}/`)
            .then((answer) => answer.ok)
            .catch(() => false)
        )
          return true
      }
      return false
    })

    const left = Bun.serve({
      port: LEFT_PORT,
      fetch: () => new Response(PAGE("left"), { headers: { "content-type": "text/html" } }),
    })
    const right = Bun.serve({
      port: RIGHT_PORT,
      fetch: () => new Response(PAGE("right"), { headers: { "content-type": "text/html" } }),
    })

    const openRemote = async (port: number, x: number, width: number, height: number) => {
      const browser = await chromium.launch({
        headless: false,
        args: [
          `--app=http://127.0.0.1:${port}/`,
          `--window-position=${x},0`,
          `--window-size=${width},${height}`,
          "--no-sandbox",
          "--disable-gpu",
          "--autoplay-policy=no-user-gesture-required",
        ],
        env: { ...process.env, DISPLAY: display },
      })
      browsers.push(browser)
      const context = browser.contexts()[0]
      const page = context?.pages()[0] ?? (await browser.newPage())
      await page.goto(`http://127.0.0.1:${port}/`)
      await page.waitForSelector("#field", { timeout: 30_000 })
      return page
    }
    const single = process.argv.includes("--single")
    const area = single ? await screenSize() : null
    const leftPage = await openRemote(LEFT_PORT, 0, area?.width ?? 1280, area?.height ?? 1024)
    const rightPage = single ? leftPage : await openRemote(RIGHT_PORT, 1280, 1024, 768)
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
    if ((await paired.exited) !== 0) throw new Error("the daemon failed to pair")
    children.push(start("daemon", ["bun", "src/index.ts", "run"], COMPUTER, env))

    const auth = JSON.stringify({
      v: 1,
      identity: { clerkUserId: null, email: "owner@example.com" },
      backend: { url: `http://localhost:${WEB_PORT}`, key: "measure" },
      user: { id: "owner", name: "owner" },
      token: session.token,
    })

    const viewer = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
    browsers.push(viewer)
    const context = await viewer.newContext({ permissions: ["clipboard-read", "clipboard-write"] })
    await context.addInitScript((record) => {
      localStorage.setItem("kiko:auth", record)
      localStorage.setItem("kiko:schema", "1")
    }, auth)
    const page = await context.newPage()
    await page.goto(`http://localhost:${WEB_PORT}/`)
    await page.waitForSelector('[data-action="computer-watch"], [data-action="skip-first-run"]', { timeout: 60_000 })
    const skip = page.locator('[data-action="skip-first-run"]')
    if ((await skip.count()) > 0) await skip.click()
    await page.waitForSelector('[data-component="first-run"]', { state: "detached", timeout: 30_000 }).catch(() => {})
    await page.waitForSelector('[data-action="computer-watch"]', { timeout: 60_000 })
    await page.click('[data-action="computer-watch"]')
    await page.waitForSelector('[data-component="computer-screen"]', { timeout: 30_000 })
    await page.waitForFunction(
      () => {
        const mode = document.querySelector('[data-component="computer-screen"]')?.getAttribute("data-mode")
        return mode === "rtc" || mode === "relay"
      },
      { timeout: 30_000 },
    )

    const takeover = page.locator('[data-action="computer-takeover"]')
    if ((await takeover.count()) > 0) await takeover.click()
    await page.waitForSelector('[data-component="computer-screen"][data-interactive]', { timeout: 15_000 })

    const picker = page.locator('[data-part="display-picker"]')
    const labels = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLOptionElement>('[data-part="display-picker"] option')].map(
          (option) => option.textContent ?? "",
        ),
      )

    const choose = async (label: string) => {
      await until(`the ${label} display`, async () =>
        page.evaluate(
          (wanted) =>
            [...document.querySelectorAll<HTMLOptionElement>('[data-part="display-picker"] option')].some((option) =>
              option.textContent?.includes(wanted),
            ),
          label,
        ),
      )
      const value = await picker.evaluate((element, wanted) => {
        const select = element as HTMLSelectElement
        return [...select.options].find((option) => option.textContent?.includes(wanted))?.value ?? null
      }, label)
      if (!value) throw new Error(`no display called ${label}`)
      await picker.selectOption(value)
      await page.waitForFunction(
        (width) => {
          const canvas = document.querySelector('[data-component="computer-screen"] canvas') as HTMLCanvasElement | null
          const video = document.querySelector('[data-component="computer-screen"] video') as HTMLVideoElement | null
          const source = video && video.videoWidth > 0 ? video.videoWidth : canvas?.width
          return typeof source === "number" && source > 0 && Math.abs(source - width) < 200
        },
        Number(label.split("×")[0]),
        { timeout: 30_000 },
      )
      await wait(800)
    }

    const stageClick = async (x: number, y: number) => {
      const box = await page.locator('[data-part="stage"]').boundingBox()
      if (!box) throw new Error("the viewer has no stage")
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y)
    }

    const events = (remote: Page) =>
      remote.evaluate(() => (window as unknown as { __events: unknown[] }).__events.length)

    if (single) {
      result.displays = await labels()
      await stageClick(0.5, 0.5)
      await until("the click on the only display", async () => (await events(leftPage)) > 0, 10_000)
      const landed = (await leftPage.evaluate(() => {
        const log = window as unknown as { __events: { x: number; y: number; screenX: number; screenY: number }[] }
        return log.__events.at(-1)
      })) as { x: number; y: number; screenX: number; screenY: number }
      result.click = landed
      await page.evaluate((text) => navigator.clipboard.writeText(text), TEXT)
      await page.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v")
      await until("the pasted text", async () => (await leftPage.inputValue("#field")) === TEXT, 30_000)
      result.pasted = await leftPage.inputValue("#field")
      const centred =
        area !== null &&
        Math.abs(landed.screenX - area.width / 2) < 80 &&
        Math.abs(landed.screenY - area.height / 2) < 80
      const exact = result.pasted === TEXT
      const pickerHidden = (await picker.count()) === 0
      result.pass = { exact, centred, pickerHidden }
      failed = !exact || !centred || !pickerHidden
    } else {
      await choose("1024×768")
      result.displays = await labels()
      const before = { left: await events(leftPage), right: await events(rightPage) }
      await stageClick(0.5, 0.5)
      await until("the click on the right display", async () => (await events(rightPage)) > before.right, 10_000)
      const landed = (await rightPage.evaluate(() => {
        const log = window as unknown as { __events: { x: number; y: number; screenX: number; screenY: number }[] }
        return log.__events.at(-1)
      })) as { x: number; y: number; screenX: number; screenY: number }
      result.rightClick = landed
      result.leftUnaffected = (await events(leftPage)) === before.left

      await page.evaluate((text) => navigator.clipboard.writeText(text), TEXT)
      await page.keyboard.press("Control+v")
      await until("the pasted text", async () => (await rightPage.inputValue("#field")) === TEXT, 30_000)
      result.pasted = await rightPage.inputValue("#field")

      const switched = { right: await events(rightPage) }
      await choose("1280×1024")
      await stageClick(0.5, 0.5)
      await until("the click on the left display", async () => (await events(leftPage)) > 0, 10_000)
      const leftClick = (await leftPage.evaluate(() => {
        const log = window as unknown as { __events: { x: number; y: number; screenX: number; screenY: number }[] }
        return log.__events.at(-1)
      })) as { x: number; y: number; screenX: number; screenY: number }
      result.leftClick = leftClick
      result.rightStayed = (await events(rightPage)) === switched.right

      const exact = result.pasted === TEXT
      const rightCenter = Math.abs(landed.screenX - 1792) < 80 && Math.abs(landed.screenY - 384) < 80
      const leftCenter = Math.abs(leftClick.screenX - 640) < 80 && Math.abs(leftClick.screenY - 512) < 80
      result.pass = {
        exact,
        rightCenter,
        leftCenter,
        rightStayed: result.rightStayed,
        leftUnaffected: result.leftUnaffected,
      }
      failed = !exact || !rightCenter || !leftCenter || result.rightStayed !== true || result.leftUnaffected !== true
    }

    left.stop(true)
    if (!single) right.stop(true)
  } finally {
    for (const browser of browsers) browser.close().catch(() => {})
    driver?.server.close()
    for (const child of children) {
      try {
        child.kill()
      } catch {}
    }
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined
  if (out) await writeFile(out, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
  if (failed) process.exit(1)
}

await main()
