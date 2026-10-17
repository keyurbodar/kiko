// Background tabs. Architecture section 19.6.
//
// A hidden tab spends nothing. After `delayMs` hidden the room socket closes.
// The user socket stays, because the server hibernates it and it is silent.
// On return the room reconnects with `hello {lastSeq}` and resyncs.
// `background()` is true while hidden, so typing pings, preloading, animation
// work, and idle IndexedDB work can stop on it.

import { createPageVisibility } from "@solid-primitives/page-visibility"
import { type Accessor, createEffect, createRoot, onCleanup } from "solid-js"
import type { RoomStore } from "./room-store"

export const HIDDEN_CLOSE_MS = 30_000

export type VisibilityOptions = {
	/** The room whose socket to close. */
	room: Pick<RoomStore, "suspend" | "resume">
	/** True while the tab is hidden. Defaults to the page visibility primitive. */
	hidden?: Accessor<boolean>
	delayMs?: number
	setTimer?: (run: () => void, ms: number) => unknown
	clearTimer?: (handle: unknown) => void
}

let visible: Accessor<boolean> | undefined

/** True while the tab is hidden. Gate pings, preloading, animation loops, and idle warm work on it. */
export function background(): boolean {
	visible ??= createRoot(() => createPageVisibility())
	return !visible()
}

export type Throttle = {
	/** Tells the throttle the tab's visibility. Same value twice does nothing. */
	setHidden(hidden: boolean): void
	stop(): void
}

/** The timing, apart from Solid, so a test can drive it. */
export function createThrottle(options: Omit<VisibilityOptions, "hidden">): Throttle {
	const { room } = options
	const delay = options.delayMs ?? HIDDEN_CLOSE_MS
	const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms))
	const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
	let timer: unknown
	let isHidden = false
	const cancel = () => {
		if (timer !== undefined) clearTimer(timer)
		timer = undefined
	}
	return {
		setHidden(next) {
			if (next === isHidden) return
			isHidden = next
			cancel()
			if (next) {
				timer = setTimer(() => {
					timer = undefined
					room.suspend()
				}, delay)
			} else room.resume()
		},
		stop: cancel,
	}
}

/** Wires one room to the tab's visibility. Call it inside a component or root. Cleanup stops it. */
export function throttleInBackground(options: VisibilityOptions): void {
	const throttle = createThrottle(options)
	const hidden = options.hidden ?? background
	createEffect(() => throttle.setHidden(hidden()))
	onCleanup(throttle.stop)
}
