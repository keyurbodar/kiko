import type { UserChange } from "@kiko/protocol"
import { userChannel } from "./socket"

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
