import { BROWSER } from "../config"
import { CdpError } from "../cdp/session"
import { evaluate, type PageState } from "./read"
import { guardScript, selectScript, settleScript } from "./script"
import type { Step, StepResult } from "./types"

type Guard = { status: "ok"; x: number; y: number; menu: boolean } | { status: "gone" | "hidden" } | { status: "stale"; label: string }

type Key = { key: string; code: string; keyCode: number; text?: string }

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
  const down = page.channel.send("Input.dispatchKeyEvent", { type: key.text ? "keyDown" : "rawKeyDown", text: key.text, ...base })
  await Promise.all([down, page.channel.send("Input.dispatchKeyEvent", { type: "keyUp", ...base })])
}

async function guard(page: PageState, id: number, focus: boolean): Promise<Guard> {
  const label = page.labels.get(id)
  if (label === undefined) return { status: "gone" }
  return evaluate<Guard>(page, guardScript(id, label, focus))
}

function refused(g: Exclude<Guard, { status: "ok" }>): StepResult {
  if (g.status === "stale") return { ok: false, reason: "stale", detail: `The control now reads "${g.label}". Read the page again.` }
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

/** Navigates and waits for load, but moves on after BROWSER.loadMs either way. */
export async function goto(page: PageState, url: string): Promise<StepResult> {
  const loaded = page.channel.waitFor("Page.loadEventFired", BROWSER.loadMs)
  const out = await page.channel.send("Page.navigate", { url })
  if (out.errorText) return { ok: false, reason: "gone", detail: out.errorText }
  await loaded
  return { ok: true }
}

async function back(page: PageState): Promise<StepResult> {
  const history = await page.channel.send("Page.getNavigationHistory")
  const entry = history.entries[history.currentIndex - 1]
  if (!entry) return { ok: false, reason: "gone", detail: "There is no page to go back to." }
  const loaded = page.channel.waitFor("Page.loadEventFired", BROWSER.loadMs)
  await page.channel.send("Page.navigateToHistoryEntry", { entryId: entry.id })
  await loaded
  return { ok: true }
}

async function perform(page: PageState, step: Step): Promise<StepResult | { ok: true; menu: boolean }> {
  switch (step.op) {
    case "click": {
      const g = await guard(page, step.id, false)
      if (g.status !== "ok") return refused(g)
      await click(page, g.x, g.y)
      return { ok: true, menu: g.menu }
    }
    case "type": {
      const g = await guard(page, step.id, true)
      if (g.status !== "ok") return refused(g)
      if (step.text) await page.channel.send("Input.insertText", { text: step.text })
      else await press(page, "Delete")
      if (step.submit) await press(page, "Enter")
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
    case "press":
      await press(page, step.key)
      return { ok: true }
    case "scroll":
      await evaluate(page, `window.scrollBy(0, ${step.direction === "down" ? "" : "-"}window.innerHeight)`)
      return { ok: true }
    case "back":
      return back(page)
    case "goto":
      return goto(page, step.url)
  }
}

function dialogResult(page: PageState): StepResult | undefined {
  if (page.dialog === undefined) return undefined
  const detail = page.dialog
  page.dialog = undefined
  return { ok: false, reason: "dialog", detail }
}

const navigates = (message: string) => /context was destroyed|navigated or closed|Cannot find context/i.test(message)

export async function act(page: PageState, step: Step): Promise<StepResult> {
  if (page.crashed) return { ok: false, reason: "crashed" }
  const early = dialogResult(page)
  if (early) return early
  // Set from the frameStartedLoading event, so the load waiter exists before the load can fire.
  let loaded: Promise<unknown> | undefined
  const offNav = page.channel.on("Page.frameStartedLoading", (event) => {
    if (event.frameId === page.targetId && !loaded) loaded = page.channel.waitFor("Page.loadEventFired", BROWSER.loadMs)
  })
  try {
    const done = await perform(page, step)
    if (!done.ok) return dialogResult(page) ?? done
    if (step.op !== "goto" && step.op !== "back") {
      await evaluate(page, settleScript("menu" in done && done.menu), true).catch((error: Error) => {
        if (!navigates(error.message)) throw error
      })
      if (loaded) await loaded
    }
    return dialogResult(page) ?? { ok: true }
  } catch (error) {
    if (page.crashed) return { ok: false, reason: "crashed" }
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof CdpError && error.kind === "timeout") return { ok: false, reason: "timeout", detail: message }
    if (error instanceof CdpError && error.kind === "closed") return { ok: false, reason: "crashed", detail: message }
    if (navigates(message)) {
      if (loaded) await loaded
      return dialogResult(page) ?? { ok: true }
    }
    throw error
  } finally {
    offNav()
  }
}

export async function screenshot(page: PageState): Promise<Uint8Array> {
  const { data } = await page.channel.send("Page.captureScreenshot", { format: "jpeg", quality: 50, optimizeForSpeed: true })
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
