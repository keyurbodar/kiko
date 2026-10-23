import type { BrowserState } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createSignal } from "solid-js"
import type { Command } from "../commands/registry"
import { userChannel } from "../sync/socket"

const [state, setState] = createSignal<BrowserState>(null)
export const browser = state

const setError = (error: string) => showToastV2({ title: error, variant: "error" })

let started = false
export function startBrowser(): void {
  if (started) return
  started = true
  userChannel.on("browserState", (frame) => setState(frame.state))
  userChannel.send({ t: "kernelStatus", reqId: "browser" })
}

let n = 0

export function openLive(mode: "watch" | "control"): void {
  const tab = window.open("about:blank", "_blank")
  if (tab) tab.opener = null
  const now = state()
  if (now) setState({ ...now, takeover: now.takeover || mode === "control", switching: now.mode === "headless" })
  const reqId = `browser${++n}`
  let timer: ReturnType<typeof setTimeout> | undefined
  const off = userChannel.on("browserLink", (frame) => {
    if (frame.reqId !== reqId) return
    off()
    clearTimeout(timer)
    if (frame.result.ok && tab) tab.location.href = frame.result.url
    else if (frame.result.ok) window.open(frame.result.url, "_blank")
    else {
      tab?.close()
      setError(frame.result.error)
    }
  })
  timer = setTimeout(() => {
    off()
    tab?.close()
    setError("The browser did not open. Try again.")
  }, 60_000)
  if (!userChannel.send({ t: "browserLink", reqId, mode })) {
    off()
    clearTimeout(timer)
    tab?.close()
    setError("You are offline.")
  }
}

export function handBack(): void {
  const now = state()
  if (now) setState({ ...now, takeover: false })
  userChannel.send({ t: "handBack" })
}

export function browserCommands(): Command[] {
  return [
    {
      id: "browser.watch",
      title: "Watch the browser",
      group: "browser",
      icon: "globe",
      when: () => !state()?.takeover,
      run: () => openLive("watch"),
    },
    {
      id: "browser.take-control",
      title: "Take control of the browser",
      group: "browser",
      icon: "globe",
      when: () => !state()?.takeover,
      run: () => openLive("control"),
    },
    {
      id: "browser.open",
      title: "Open the browser",
      group: "browser",
      icon: "globe",
      when: () => state()?.takeover === true,
      run: () => openLive("control"),
    },
    {
      id: "browser.release",
      title: "Release control of the browser",
      group: "browser",
      icon: "globe",
      when: () => state()?.takeover === true,
      run: handBack,
    },
  ]
}

export function closeBrowser(): void {
  setState(null)
  userChannel.send({ t: "closeBrowser" })
}
