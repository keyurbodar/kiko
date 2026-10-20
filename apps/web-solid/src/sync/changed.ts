import type { UserChange } from "@kiko/protocol"
import { createResource, getOwner, onCleanup, type ResourceOptions, type ResourceReturn } from "solid-js"
import { userChannel } from "./socket"

const RELOAD_AFTER_MS = 300

export function onChanged(what: UserChange, reload: () => unknown, delay = RELOAD_AFTER_MS): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined
	const soon = () => {
		clearTimeout(timer)
		timer = setTimeout(() => void reload(), delay)
	}
	const offFrame = userChannel.on("changed", (frame) => frame.what === what && soon())
	const offOpen = userChannel.onOpen(soon)
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
