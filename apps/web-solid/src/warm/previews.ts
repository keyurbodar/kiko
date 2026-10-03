// Link previews the client has seen, with the card colour it picked for each, so a reload
// paints every card at once and asks the server nothing. Keyed by the page URL.

import type { WebPagePreview } from "../lib/types"
import type { Warm } from "./db"

/** The most previews kept. The oldest go first. */
export const PREVIEW_SHELF_CAP = 500

export type PreviewRecord = {
	url: string
	/** Null when the page has no card. */
	preview: WebPagePreview | null
	/** The panel colour. Empty when the picture had none worth using; absent before it loaded. */
	color?: string
	/** Epoch milliseconds of the last use. */
	at: number
}

/** Every stored preview, newest first. Trims the shelf to its cap on the way. */
export async function loadPreviews(warm: Warm, cap = PREVIEW_SHELF_CAP): Promise<PreviewRecord[]> {
	const all = (await warm.getAll<PreviewRecord>("previews")).sort((a, b) => b.at - a.at)
	for (const old of all.slice(cap)) warm.delete("previews", old.url)
	return all.slice(0, cap)
}

export function savePreview(warm: Warm, record: PreviewRecord): void {
	warm.put("previews", record.url, record)
}
