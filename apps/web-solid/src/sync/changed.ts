// A list the user socket does not carry (routines, memory, open loops) changed on the server. The
// first load of a list calls `watchChanged`, and from then on it reloads on the server's `changed`
// frame and after a reconnect, so an open panel stays true without a reopen.

import type { UserChange } from "@kiko/protocol"
import { userChannel } from "./user-channel"

const RELOAD_AFTER_MS = 300

const watching = new Set<UserChange>()

export function watchChanged(what: UserChange, reload: () => unknown): void {
	if (watching.has(what)) return
	watching.add(what)
	let timer: ReturnType<typeof setTimeout> | undefined
	const soon = () => {
		clearTimeout(timer)
		timer = setTimeout(() => void reload(), RELOAD_AFTER_MS)
	}
	userChannel.on("changed", (frame) => frame.what === what && soon())
	userChannel.onOpen(soon)
}
