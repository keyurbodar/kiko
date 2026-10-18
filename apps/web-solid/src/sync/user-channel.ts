// The one user socket, shared.
//
// The user store owns the socket. Everything else that talks to UserDO (the saved look, memory,
// Composio) sends and listens through this channel instead of opening a socket of its own: four
// sockets to the same object cost four connections, four pings, and four catch-ups.

import type { ClientToUser, UserToClient } from "@kiko/protocol"

type FrameOf<T extends UserToClient["t"]> = Extract<UserToClient, { t: T }>

export type UserChannel = {
	/** False when the socket is not open. The caller keeps the frame and resends it from `onOpen`. */
	send(frame: ClientToUser): boolean
	/** Calls `fn` with every frame of type `t`. Returns the unsubscribe. */
	on<T extends UserToClient["t"]>(t: T, fn: (frame: FrameOf<T>) => void): () => void
	/** Runs after `hello` on every connect. Returns the unsubscribe. */
	onOpen(fn: () => void): () => void
}

/** The socket owner's side. */
export type UserChannelHost = UserChannel & {
	/** Makes `send` the channel's socket. Returns the detach, which does nothing once another socket attached. */
	attach(send: (frame: ClientToUser) => boolean): () => void
	deliver(frame: UserToClient): void
	opened(): void
}

export function createUserChannel(): UserChannelHost {
	const listeners = new Map<string, Set<(frame: never) => void>>()
	const openers = new Set<() => void>()
	let sender: ((frame: ClientToUser) => boolean) | null = null
	return {
		send: (frame) => sender?.(frame) ?? false,
		on(t, fn) {
			let set = listeners.get(t)
			if (!set) listeners.set(t, (set = new Set()))
			set.add(fn as (frame: never) => void)
			return () => {
				set.delete(fn as (frame: never) => void)
				if (set.size === 0) listeners.delete(t)
			}
		},
		onOpen(fn) {
			openers.add(fn)
			return () => void openers.delete(fn)
		},
		attach(send) {
			sender = send
			return () => {
				if (sender === send) sender = null
			}
		},
		deliver(frame) {
			for (const fn of listeners.get(frame.t) ?? []) (fn as (f: UserToClient) => void)(frame)
		},
		opened() {
			for (const fn of [...openers]) fn()
		},
	}
}

/** The app's channel. The user store attaches its socket to it. */
export const userChannel = createUserChannel()
