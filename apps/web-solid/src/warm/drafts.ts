// The composer's unsent text per room, so it survives a reload.

import type { MessageId, RoomId } from "@kiko/protocol"
import { createSignal } from "solid-js"
import type { Warm } from "./db"

export type Draft = {
	roomId: RoomId
	text: string
	replyTo?: MessageId
	/** Epoch milliseconds. */
	updatedAt: number
}

/** An empty draft with no reply is removed, not stored. */
export function saveDraft(warm: Warm, draft: Draft) {
	if (draft.text === "" && !draft.replyTo) warm.delete("drafts", draft.roomId)
	else warm.put("drafts", draft.roomId, draft)
}

export const getDraft = (warm: Warm, roomId: RoomId) => warm.get<Draft>("drafts", roomId)

export const allDrafts = (warm: Warm) => warm.getAll<Draft>("drafts")

export function clearDraft(warm: Warm, roomId: RoomId) {
	warm.delete("drafts", roomId)
	warm.delete("meta", scrollKey(roomId))
}

/** Where the reader was: the message at the top of the view and how far into it. */
export type ScrollPosition = {
	messageId: MessageId | string
	/** Pixels the top of the view sits below the top of that message. */
	offset: number
}

const scrollKey = (roomId: RoomId | string) => `scroll:${roomId}`

export const saveScroll = (warm: Warm, roomId: RoomId | string, position: ScrollPosition | null) => {
	if (position) warm.put("meta", scrollKey(roomId), { ...position, roomId })
	else warm.delete("meta", scrollKey(roomId))
}

export const getScroll = (warm: Warm, roomId: RoomId | string) =>
	warm.get<ScrollPosition>("meta", scrollKey(roomId))

/** Longest time a typed character waits before it is queued for IndexedDB. */
export const DRAFT_DEBOUNCE_MS = 300

/**
 * Every draft and scroll position, held in memory so a chat switch reads them in
 * the same frame. IndexedDB is the copy that survives a reload. One book per
 * user. `ready` is false until the first read from IndexedDB finishes.
 */
export function createDraftBook(warm: Warm, debounceMs = DRAFT_DEBOUNCE_MS) {
	const drafts = new Map<string, Draft>()
	const scrolls = new Map<string, ScrollPosition>()
	const [version, setVersion] = createSignal(0)
	const [ready, setReady] = createSignal(false)
	const timers = new Map<string, ReturnType<typeof setTimeout>>()
	const scrollTimers = new Map<string, ReturnType<typeof setTimeout>>()
	let closed = false

	const persist = (roomId: string) => {
		const timer = timers.get(roomId)
		if (timer !== undefined) clearTimeout(timer)
		timers.delete(roomId)
		const draft = drafts.get(roomId)
		if (draft) saveDraft(warm, draft)
	}

	void Promise.all([
		allDrafts(warm),
		warm.getAll<ScrollPosition & { roomId: string }>("meta", { lower: "scroll:", upper: "scroll:\uffff" }),
	]).then(([all, saved]) => {
		if (closed) return
		for (const { roomId, ...position } of saved) if (!scrolls.has(roomId)) scrolls.set(roomId, position)
		// A draft typed before the read finished is newer than the stored one.
		for (const d of all) if (!drafts.has(d.roomId)) drafts.set(d.roomId, d)
		setReady(true)
		setVersion((v) => v + 1)
	})

	const onHide = () => void book.flush()
	globalThis.addEventListener?.("pagehide", onHide)

	const book = {
		ready,
		get: (roomId: string): Draft | undefined => drafts.get(roomId),
		/** Reactive. True when the chat has unsent text. A bare reply target is not a draft marker. */
		has(roomId: string): boolean {
			version()
			return (drafts.get(roomId)?.text ?? "") !== ""
		},
		/** Change the text and, when given, the reply target. Persists after the debounce. */
		save(roomId: string, patch: { text?: string; replyTo?: MessageId | null }) {
			const before = drafts.get(roomId)
			const next: Draft = {
				roomId: roomId as RoomId,
				text: patch.text ?? before?.text ?? "",
				updatedAt: Date.now(),
			}
			const replyTo = patch.replyTo === undefined ? before?.replyTo : (patch.replyTo ?? undefined)
			if (replyTo) next.replyTo = replyTo
			if (before && before.text === next.text && before.replyTo === next.replyTo) return
			if (next.text === "" && !next.replyTo) drafts.delete(roomId)
			else drafts.set(roomId, next)
			if ((before?.text ?? "") === "" !== (next.text === "")) setVersion((v) => v + 1)
			clearTimeout(timers.get(roomId))
			timers.set(
				roomId,
				setTimeout(() => {
					timers.delete(roomId)
					if (next.text === "" && !next.replyTo) warm.delete("drafts", roomId)
					else warm.put("drafts", roomId, drafts.get(roomId))
				}, debounceMs),
			)
		},
		scroll: (roomId: string) => scrolls.get(roomId),
		/** Remember where the reader is. Cheap enough to call on every scroll. */
		saveScroll(roomId: string, position: ScrollPosition | null) {
			if (position) scrolls.set(roomId, position)
			else scrolls.delete(roomId)
			clearTimeout(scrollTimers.get(roomId))
			scrollTimers.set(
				roomId,
				setTimeout(() => {
					scrollTimers.delete(roomId)
					saveScroll(warm, roomId, scrolls.get(roomId) ?? null)
				}, debounceMs),
			)
		},
		/** Writes every pending draft now, for a reload. */
		flush() {
			for (const roomId of [...timers.keys()]) persist(roomId)
			for (const [roomId, timer] of scrollTimers) {
				clearTimeout(timer)
				saveScroll(warm, roomId, scrolls.get(roomId) ?? null)
			}
			scrollTimers.clear()
			return warm.flush()
		},
		close() {
			closed = true
			globalThis.removeEventListener?.("pagehide", onHide)
			void book.flush()
		},
	}
	return book
}

export type DraftBook = ReturnType<typeof createDraftBook>
