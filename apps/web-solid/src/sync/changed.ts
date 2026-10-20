// Server data the user socket does not carry as events: routines, memory, models, providers,
// souls. The server sends `changed {what}` when one changes. Every read of such data goes through
// `onChanged` or `createLive`, so an open screen stays true without a reload. A read that skips
// them goes stale; the `live-server-data` rule in `scripts/check-rules.ts` refuses a bare `createResource`.

import type { UserChange } from "@kiko/protocol"
import { createResource, getOwner, onCleanup, type ResourceOptions, type ResourceReturn } from "solid-js"
import { userChannel } from "./user-channel"

const RELOAD_AFTER_MS = 300

/** Calls `reload` once after a burst of `changed {what}` frames, and after every reconnect. Returns the unsubscribe. */
export function onChanged(what: UserChange, reload: () => unknown): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined
	const soon = () => {
		clearTimeout(timer)
		timer = setTimeout(() => void reload(), RELOAD_AFTER_MS)
	}
	const offFrame = userChannel.on("changed", (frame) => frame.what === what && soon())
	const offOpen = userChannel.onOpen(soon)
	return () => {
		clearTimeout(timer)
		offFrame()
		offOpen()
	}
}

/**
 * A resource for server data of kind `what`. It loads like `createResource`, then reloads on the
 * server's `changed` frame and after a reconnect, keeping the last value while it does. It stops
 * listening with its owner.
 */
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
