import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser, type Page } from "playwright"
import { mintPairCode } from "../src/computer/pairing"
import {
  finishFirstRun,
  signIn,
  start,
  startWeb,
  startWorker,
  until,
  wait,
  WEB_PORT,
  SERVER_PORT,
  type Child,
} from "./measure-harness"

const LEFT_PORT = 5198
const RIGHT_PORT = 5197
const ROOT = join(import.meta.dirname, "..", "..", "..")
const COMPUTER = join(ROOT, "apps", "computer")
const TEXT = "Grüße, 世界 — deux lignes\nligne deux\n🎉 end"

const PAGE = (name: string) => `<!doctype html><meta charset="utf-8">
<style>
html,body{margin:0;height:100%;background:#111;color:#eee;font:16px system-ui}
#field{position:absolute;left:15%;top:25%;width:70%;height:30%;font-size:20px}
</style>
<textarea id="field" autocomplete="off"></textarea>
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
  const display = process.env.DISPLAY ?? ":99"
  let driver: ReturnType<typeof fakeDriver> | null = null
  const browsers: Browser[] = []
  const result: Record<string, unknown> = { text: TEXT }
  let failed = false
  try {
    const driverPath = join(dir, "driver.sock")
    driver = fakeDriver(driverPath)
    await driver.ready

    const { kek } = await startWorker(children, dir)
    await startWeb(children)

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
    const leftPage = await openRemote(LEFT_PORT, 0, area?.width ?? 1280, area?.height ?? 800)
    const rightPage = single ? leftPage : await openRemote(RIGHT_PORT, 0, 1280, 800)
    await wait(1_500)

    const session = { token: await signIn() }

    const minted = await mintPairCode(kek, "owner")
    const computerDir = join(dir, "pc")
    const env = { KIKO_COMPUTER_DIR: computerDir, KIKO_DRIVER: driverPath, DISPLAY: display }
    const paired = start(
      "pair",
      ["bun", "src/index.ts", "pair", `http://127.0.0.1:${SERVER_PORT}#${minted.code}`, "--name", "kiko-ci"],
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
    page.on("console", (message) => process.stderr.write(`[viewer] ${message.type()}: ${message.text()}\n`))
    page.on("pageerror", (error) => process.stderr.write(`[viewer] pageerror: ${error.message}\n`))
    await page.goto(`http://localhost:${WEB_PORT}/`)
    await page.waitForSelector('[data-action="computer-watch"], [data-action="skip-first-run"]', { timeout: 60_000 })
    await finishFirstRun(page)
    await page.reload()
    await page.waitForSelector('[data-action="computer-watch"], [data-action="skip-first-run"]', { timeout: 60_000 })
    await finishFirstRun(page)
    await page.waitForSelector('[data-action="computer-watch"]', { timeout: 60_000 })
    await page.click('[data-action="computer-watch"]', { timeout: 10_000 })
    await page.waitForSelector('[data-component="computer-screen"]', { timeout: 45_000 })
    let ticks = 0
    let streaming = true
    try {
      await until(
        "the screen to stream",
        async () => {
          const state = await page.evaluate(() => {
            const root = document.querySelector('[data-component="computer-screen"]')
            const video = root?.querySelector("video") as HTMLVideoElement | null
            const canvas = root?.querySelector("canvas") as HTMLCanvasElement | null
            return {
              mode: root?.getAttribute("data-mode") ?? null,
              width: video?.videoWidth ?? 0,
              canvas: canvas?.width ?? 0,
              ready: video?.readyState ?? 0,
            }
          })
          if (ticks % 8 === 0) process.stderr.write(`[viewer] screen ${JSON.stringify(state)}\n`)
          ticks += 1
          return state.mode === "rtc" || state.mode === "relay"
        },
        60_000,
      )
    } catch {
      streaming = false
    }
    result.streaming = streaming

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

    const choose = async (label: string, width: number) => {
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
      if (streaming)
        await page
          .waitForFunction(
            (wanted) => {
              const canvas = document.querySelector(
                '[data-component="computer-screen"] canvas',
              ) as HTMLCanvasElement | null
              const video = document.querySelector(
                '[data-component="computer-screen"] video',
              ) as HTMLVideoElement | null
              const source = video && video.videoWidth > 0 ? video.videoWidth : canvas?.width
              return typeof source === "number" && source > 0 && Math.abs(source - wanted) < 200
            },
            width,
            { timeout: 30_000 },
          )
          .catch(() => {})
      await wait(800)
    }

    const pasteInto = async (text: string) => {
      await page.evaluate((value) => {
        const sink = document.querySelector('[data-part="sink"]')
        const data = new DataTransfer()
        data.setData("text/plain", value)
        sink?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
      }, text)
    }

    const pointer = async () => {
      const out = await command(["xdotool", "getmouselocation"])
      const match = out ? /x:(-?\d+) y:(-?\d+)/.exec(out) : null
      if (!match?.[1] || !match[2]) return null
      return { x: Number(match[1]), y: Number(match[2]) }
    }

    const stageClick = async (x: number, y: number) => {
      const box = await page.locator('[data-part="stage"]').boundingBox()
      if (!box) throw new Error("the viewer has no stage")
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y)
    }

    const events = (remote: Page) =>
      remote.evaluate(() => (window as unknown as { __events: unknown[] }).__events.length)

    const inspect = (remote: Page) =>
      remote.evaluate(() => {
        const log = window as unknown as { __events: unknown[] }
        const field = document.getElementById("field") as HTMLTextAreaElement | null
        return {
          active: document.activeElement?.id || document.activeElement?.tagName || null,
          clicks: log.__events.length,
          last: log.__events.at(-1) ?? null,
          value: field?.value ?? null,
        }
      })

    if (single) {
      result.displays = await labels()
      await stageClick(0.5, 0.5)
      await until("the click on the only display", async () => (await events(leftPage)) > 0, 10_000).catch(
        async (error) => {
          result.fields = { left: await inspect(leftPage) }
          throw error
        },
      )
      const landed = (await leftPage.evaluate(() => {
        const log = window as unknown as { __events: { x: number; y: number; screenX: number; screenY: number }[] }
        return log.__events.at(-1)
      })) as { x: number; y: number; screenX: number; screenY: number }
      result.click = landed
      await pasteInto(TEXT)
      await until("the pasted text", async () => (await leftPage.inputValue("#field")) === TEXT, 30_000).catch(
        async (error) => {
          result.fields = { left: await inspect(leftPage) }
          throw error
        },
      )
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
      const landed = (remote: Page) =>
        remote.evaluate(() => {
          const log = window as unknown as { __events: { x: number; y: number; screenX: number; screenY: number }[] }
          return log.__events.at(-1)
        }) as Promise<{ x: number; y: number; screenX: number; screenY: number } | undefined>
      const at = async (x: number, y: number) => {
        const spot = await pointer()
        return spot !== null && Math.abs(spot.x - x) < 8 && Math.abs(spot.y - y) < 8
      }
      const pasted = async () =>
        (await leftPage.inputValue("#field")) === TEXT || (await rightPage.inputValue("#field")) === TEXT

      await choose("Display 2", 1280)
      result.displays = await labels()
      await stageClick(0.5, 0.5)
      await until("the click on the second display", () => at(1280 + 640, 400), 10_000)
      result.second = await pointer()

      await choose("Display 1", 1280)
      await stageClick(0.5, 0.5)
      await until("the click on the first display", () => at(640, 400), 10_000)
      result.first = await pointer()

      await page.keyboard.press("KeyA")
      await wait(500)
      result.typed = await leftPage.evaluate(() => (document.getElementById("field") as HTMLTextAreaElement).value)
      process.stderr.write(`[type probe] the field holds ${JSON.stringify(result.typed)}\n`)
      await pasteInto(TEXT)
      await until("the pasted text", async () => (await pasted()) === TEXT, 30_000).catch(async (error) => {
        result.fields = { left: await inspect(leftPage), right: await inspect(rightPage) }
        throw error
      })

      const exact = await pasted()
      result.click = (await landed(leftPage)) ?? (await landed(rightPage)) ?? null
      const secondCentred = Math.abs((result.second as { x: number }).x - 1792) < 8
      const firstCentred = Math.abs((result.first as { x: number }).x - 640) < 8
      result.pass = { exact, secondCentred, firstCentred }
      failed = !exact || !secondCentred || !firstCentred
    }

    left.stop(true)
    if (!single) right.stop(true)
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    failed = true
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
