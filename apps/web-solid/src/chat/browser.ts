// The user's browser as the client knows it (architecture section 27.7). `browserState` pushes
// carry hosts and never a URL. The live view URL comes back once, to the socket that pressed the
// button, and goes straight into the tab the click opened.

import type { BrowserState } from "@yuki/protocol"
import { createSignal } from "solid-js"
import { userChannel } from "../sync/user-channel"

const [state, setState] = createSignal<BrowserState>(null)
const [error, setError] = createSignal<string | null>(null)
export const browser = state
export const browserError = error

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
 * tab opened later from a socket frame. Take over shows as taken over at once, and a headless
 * browser shows as switching until the server's state says otherwise.
 */
export function openLive(mode: "watch" | "control"): void {
	const tab = window.open("about:blank", "_blank")
	if (tab) tab.opener = null
	setError(null)
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

export function closeBrowser(): void {
	setState(null)
	userChannel.send({ t: "closeBrowser" })
}
