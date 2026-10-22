import type { UserChange } from "@kiko/protocol"
import { createEffect, createResource, createRoot, createSignal, getOwner, onCleanup, type ResourceOptions, type ResourceReturn, untrack } from "solid-js"
import { userChannel } from "./socket"

const RELOAD_AFTER_MS = 300

const RESUME_AFTER_MS = 3_000

let downAt: number | undefined
const [resumeEpoch, setResumeEpoch] = createRoot(() => createSignal(0))

userChannel.onStatus((status) => {
	if (status !== "open") {
		if (downAt === undefined) downAt = Date.now()
		return
	}
	const since = downAt
	downAt = undefined
	if (since === undefined || Date.now() - since < RESUME_AFTER_MS) return
	setResumeEpoch((n) => n + 1)
})

export function onChanged(what: UserChange, reload: () => unknown, delay = RELOAD_AFTER_MS): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined
	let seen = resumeEpoch()
	const soon = () => {
		clearTimeout(timer)
		timer = setTimeout(() => void reload(), delay)
	}
	const offFrame = userChannel.on("changed", (frame) => frame.what === what && soon())
	const offOpen = createRoot((dispose) => {
		createEffect(() => {
			const epoch = resumeEpoch()
			if (epoch === seen) return
			seen = epoch
			untrack(soon)
		})
		return dispose
	})
	return () => {
		clearTimeout(timer)
		offFrame()
		offOpen()
	}
}

export function createLive<T, S>(
	what: UserChange,
	source: () => S | false | null | undefined,
	fetcher: (key: S) => T | Promise<T>,
	options?: ResourceOptions<T, S>,
): ResourceReturn<T> {
	const res = createResource<T, S>(source, fetcher, options as ResourceOptions<T, S> & { initialValue: T })
	const stop = onChanged(what, () => res[1].refetch())
	if (getOwner()) onCleanup(stop)
	return res as ResourceReturn<T>
}
