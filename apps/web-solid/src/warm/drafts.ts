// The composer's unsent text per room, so it survives a reload.

import type { MessageId, RoomId } from "@kiko/protocol"
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
}
