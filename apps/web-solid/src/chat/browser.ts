// The user's browser as the client knows it (architecture section 27.7). `browserState` pushes
// carry hosts and never a URL. The live view URL comes back once, to the socket that pressed the
// button, and goes straight into the tab the click opened.

import type { BrowserState } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createSignal } from "solid-js"
import type { Command } from "../commands/registry"
import { userChannel } from "../sync/user-channel"

const [state, setState] = createSignal<BrowserState>(null)
export const browser = state

/** A toast, so the failure shows wherever the press came from: the bar, a card, Settings, or the palette. */
const setError = (error: string) => showToastV2({ title: error, variant: "error" })

let started = false
/** Listens for pushes and asks for the current state once. The server also pushes it on every hello. */
export function startBrowser(): void {
	if (started) return
	started = true
	userChannel.on("browserState", (frame) => setState(frame.state))
	userChannel.send({ t: "kernelStatus", reqId: "browser" })
}

let n = 0

/**
 * Opens the live view in a new tab. The tab opens on the click, empty, because a browser blocks a
 * tab opened later from a socket frame. Take control shows as taken at once, and a headless
 * browser shows as switching until the server's state says otherwise.
 */
export function openLive(mode: "watch" | "control"): void {
	const tab = window.open("about:blank", "_blank")
	if (tab) tab.opener = null
	const now = state()
	if (now) setState({ ...now, takeover: now.takeover || mode === "control", switching: now.mode === "headless" })
	const reqId = `browser${++n}`
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
	const timer = setTimeout(() => {
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

/** The browser in the palette, any time: watch it, take control, or give control back. Watching or taking control opens one when none is open. */
export function browserCommands(): Command[] {
	return [
		{ id: "browser.watch", title: "Watch the browser", group: "browser", icon: "globe", when: () => !state()?.takeover, run: () => openLive("watch") },
		{ id: "browser.take-control", title: "Take control of the browser", group: "browser", icon: "globe", when: () => !state()?.takeover, run: () => openLive("control") },
		{ id: "browser.open", title: "Open the browser", group: "browser", icon: "globe", when: () => state()?.takeover === true, run: () => openLive("control") },
		{ id: "browser.release", title: "Release control of the browser", group: "browser", icon: "globe", when: () => state()?.takeover === true, run: handBack },
	]
}

export function closeBrowser(): void {
	setState(null)
	userChannel.send({ t: "closeBrowser" })
}
