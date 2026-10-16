import { createSignal } from "solid-js"

/*
 * The file viewer's saved switches and its full-size state. The panel and the full-size dialog
 * read the same signals, so a switch flipped in one holds in the other. Reading rendered or as
 * source is a preference, not a property of one file, as in t3code.
 */

/** A saved switch. Storage can throw in a private window; the switch then lasts the session. */
function stored(key: string, fallback: boolean) {
	let initial = fallback
	try {
		const raw = localStorage.getItem(key)
		if (raw !== null) initial = raw === "1"
	} catch {}
	const [get, set] = createSignal(initial)
	const save = (value: boolean) => {
		set(value)
		try {
			localStorage.setItem(key, value ? "1" : "0")
		} catch {}
	}
	return [get, save] as const
}

export const PREFS = {
	markdown: stored("kiko:file-render-markdown", false),
	table: stored("kiko:file-render-table", true),
	html: stored("kiko:file-render-html", false),
}
export const [wrap, setWrap] = stored("kiko:file-word-wrap", true)
export const [fullSize, setFullSize] = createSignal(false)
