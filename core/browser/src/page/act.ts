import { BROWSER } from "../config"
import { CdpError } from "../cdp/session"
import { evaluate, flush, navigates, type PageState } from "./read"
import { guardScript, selectScript } from "./script"
import type { ControlId, Step, StepResult } from "./types"

type Guard =
  | { status: "ok"; x: number; y: number; menu: boolean }
  | { status: "gone" | "hidden" }
  | { status: "stale"; label: string }

type Key = { key: string; code: string; keyCode: number; text?: string }

const WAIT_MAX_MS = 10_000
const WAIT_TIMEOUT_MS = 8_000
const WAIT_POLL_MS = 200
const FULL_PAGE_MAX_PX = 16_000

const KEYS: Record<string, Key> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
}

function keyOf(name: string): Key {
  const known = KEYS[name] ?? KEYS[name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()]
  if (known) return known
  const upper = name.toUpperCase()
  return { key: name, code: /^[a-z]$/i.test(name) ? `Key${upper}` : "", keyCode: upper.charCodeAt(0), text: name }
}

async function press(page: PageState, name: string): Promise<void> {
  const key = keyOf(name)
  const base = { key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode }
  const down = page.channel.send("Input.dispatchKeyEvent", {
    type: key.text ? "keyDown" : "rawKeyDown",
    text: key.text,
    ...base,
  })
  await Promise.all([down, page.channel.send("Input.dispatchKeyEvent", { type: "keyUp", ...base })])
}

async function guard(page: PageState, id: number, focus: boolean): Promise<Guard> {
  const label = page.labels.get(id)
  if (label === undefined) return { status: "gone" }
  return evaluate<Guard>(page, guardScript(id, label, focus))
}

function refused(g: Exclude<Guard, { status: "ok" }>): StepResult {
  if (g.status === "stale")
    return { ok: false, reason: "stale", detail: `The control now reads "${g.label}". Read the page again.` }
  return { ok: false, reason: g.status }
}

async function click(page: PageState, x: number, y: number): Promise<void> {
  const at = { x, y, button: "left" as const, clickCount: 1 }
  await Promise.all([
    page.channel.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }),
    page.channel.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at }),
    page.channel.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at }),
  ])
}

export function schemeError(url: string): string | undefined {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return "only http and https urls"
  }
  return protocol === "http:" || protocol === "https:" ? undefined : "only http and https urls"
}

export async function goto(page: PageState, url: string): Promise<StepResult> {
  const invalid = schemeError(url)
  if (invalid) return { ok: false, reason: "gone", detail: invalid }
  const loaded = page.channel.waitFor("Page.loadEventFired", BROWSER.loadMs)
  const out = await page.channel.send("Page.navigate", { url })
  if (out.errorText) return { ok: false, reason: "gone", detail: out.errorText }
  await loaded
  return { ok: true }
}

const NAVIGATES = new Set<Step["op"]>(["goto", "back", "forward", "reload"])

async function walk(page: PageState, by: -1 | 1): Promise<StepResult> {
  const history = await page.channel.send("Page.getNavigationHistory")
  const entry = history.entries[history.currentIndex + by]
  if (!entry)
    return {
      ok: false,
      reason: "gone",
      detail: by < 0 ? "There is no page to go back to." : "There is no page to go forward to.",
    }
  const loaded = page.channel.waitFor("Page.loadEventFired", BROWSER.loadMs)
  await page.channel.send("Page.navigateToHistoryEntry", { entryId: entry.id })
  await loaded
  return { ok: true }
}

async function reload(page: PageState): Promise<StepResult> {
  const loaded = page.channel.waitFor("Page.loadEventFired", BROWSER.loadMs)
  await page.channel.send("Page.reload")
  await loaded
  return { ok: true }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function bodyText(page: PageState): Promise<string | undefined> {
  try {
    return await evaluate<string>(page, `document.body ? document.body.innerText : ""`)
  } catch (error) {
    if (error instanceof Error && navigates(error.message)) return undefined
    throw error
  }
}

async function awaitPage(page: PageState, step: Extract<Step, { op: "wait" }>): Promise<StepResult> {
  if (step.ms !== undefined) {
    await sleep(Math.min(step.ms, WAIT_MAX_MS))
    return { ok: true }
  }
  const timeoutMs = step.timeoutMs ?? WAIT_TIMEOUT_MS
  if (step.navigation) {
    const loaded = await page.channel.waitFor("Page.loadEventFired", timeoutMs)
    return loaded === undefined
      ? { ok: false, reason: "timeout", detail: `no page load within ${timeoutMs} ms` }
      : { ok: true }
  }
  if (step.text === undefined && step.gone === undefined)
    return { ok: false, reason: "gone", detail: "wait needs text, gone, ms, or navigation" }
  const want = [
    step.text === undefined ? "" : `"${step.text}" to appear`,
    step.gone === undefined ? "" : `"${step.gone}" to go`,
  ]
    .filter(Boolean)
    .join(" and ")
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const body = await bodyText(page)
    if (
      body !== undefined &&
      (step.text === undefined || body.includes(step.text)) &&
      (step.gone === undefined || !body.includes(step.gone))
    ) {
      return { ok: true }
    }
    if (Date.now() >= deadline)
      return { ok: false, reason: "timeout", detail: `timed out after ${timeoutMs} ms waiting for ${want}` }
    await sleep(WAIT_POLL_MS)
  }
}

async function perform(page: PageState, step: Step): Promise<StepResult | { ok: true; menu: boolean }> {
  switch (step.op) {
    case "click": {
      const g = await guard(page, step.id, false)
      if (g.status !== "ok") return refused(g)
      await click(page, g.x, g.y)
      return { ok: true, menu: g.menu }
    }
    case "hover": {
      const g = await guard(page, step.id, false)
      if (g.status !== "ok") return refused(g)
      await page.channel.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: g.x, y: g.y })
      return { ok: true, menu: g.menu }
    }
    case "type": {
      const g = await guard(page, step.id, true)
      if (g.status !== "ok") return refused(g)
      const text = step.text ? page.channel.send("Input.insertText", { text: step.text }) : press(page, "Delete")
      await Promise.all([text, step.submit ? press(page, "Enter") : undefined])
      return { ok: true, menu: g.menu }
    }
    case "select": {
      const g = await guard(page, step.id, false)
      if (g.status !== "ok") return refused(g)
      const out = await evaluate<string>(page, selectScript(step.id, step.option))
      if (out === "gone") return { ok: false, reason: "gone" }
      if (out !== "ok") return { ok: false, reason: "stale", detail: `${out}: ${step.option}` }
      return { ok: true }
    }
    case "wait":
      return awaitPage(page, step)
    case "press":
      await press(page, step.key)
      return { ok: true }
    case "scroll":
      await evaluate(page, `window.scrollBy(0, ${step.direction === "down" ? "" : "-"}window.innerHeight)`)
      return { ok: true }
    case "back":
      return walk(page, -1)
    case "forward":
      return walk(page, 1)
    case "reload":
      return reload(page)
    case "goto":
      return goto(page, step.url)
  }
}

export async function act(page: PageState, step: Step): Promise<StepResult> {
  if (page.crashed) return { ok: false, reason: "crashed" }
  try {
    if (NAVIGATES.has(step.op)) page.settle = undefined
    else if (step.op === "press") await flush(page)
    const done = await perform(page, step)
    if (!done.ok) return done
    if (!NAVIGATES.has(step.op)) page.settle = "menu" in done && done.menu
    return { ok: true }
  } catch (error) {
    if (page.crashed) return { ok: false, reason: "crashed" }
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof CdpError && error.kind === "timeout") return { ok: false, reason: "timeout", detail: message }
    if (error instanceof CdpError && error.kind === "closed") return { ok: false, reason: "crashed", detail: message }
    if (navigates(message)) {
      if (page.loading) await page.loading
      return { ok: true }
    }
    throw error
  }
}

async function fullPageClip(page: PageState) {
  const metrics = await page.channel.send("Page.getLayoutMetrics")
  const size = metrics.cssContentSize ?? metrics.contentSize
  return {
    x: 0,
    y: 0,
    width: Math.ceil(size.width),
    height: Math.min(Math.ceil(size.height), FULL_PAGE_MAX_PX),
    scale: 1,
  }
}

export async function screenshot(page: PageState, opts: { fullPage?: boolean } = {}): Promise<Uint8Array> {
  await flush(page)
  const clip = opts.fullPage ? await fullPageClip(page) : undefined
  const { data } = await page.channel.send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 50,
    optimizeForSpeed: true,
    ...(clip ? { clip, captureBeyondViewport: true } : {}),
  })
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
