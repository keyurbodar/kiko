import type { BrowserState } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createSignal } from "solid-js"
import type { Command } from "../commands/registry"
import { connection } from "../state/connection"
import { failureMessage, owner, run } from "../state/runtime"
import { onUserSignal } from "../state/user"

const [state, setState] = createSignal<BrowserState>(null)
export const browser = state

const setError = (error: string) => showToastV2({ title: error, variant: "error" })

let started = false
export function startBrowser(): void {
  if (started) return
  started = true
  onUserSignal("browserState", (signal) => setState(signal.state))
}

export function openLive(mode: "watch" | "control"): void {
  const tab = window.open("about:blank", "_blank")
  if (tab) tab.opener = null
  const now = state()
  if (now) setState({ ...now, takeover: now.takeover || mode === "control", switching: now.mode === "headless" })
  if (!connection.connected()) {
    tab?.close()
    setError("You are offline.")
    return
  }
  void run(owner.commands.browserLink, { mode }).then((result) => {
    const link =
      result._tag === "Success"
        ? result.value
        : { ok: false as const, error: failureMessage(result.cause, "The browser did not open. Try again.") }
    if (link.ok && tab) tab.location.href = link.url
    else if (link.ok) window.open(link.url, "_blank")
    else {
      tab?.close()
      setError(link.error)
    }
  })
}

export function handBack(): void {
  const now = state()
  if (now) setState({ ...now, takeover: false })
  void run(owner.commands.browserHandBack, {})
}

export function browserCommands(): Command[] {
  return [
    {
      id: "browser.watch",
      title: "Watch the browser",
      group: "browser",
      icon: "globe",
      when: () => state() !== null && !state()?.takeover,
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
  void run(owner.commands.browserClose, {})
}
