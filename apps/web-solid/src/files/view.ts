import type { FileRef } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { fileReveal } from "../chat/side/surfaces"
import { PREVIEW_BYTES, readText } from "./api"
import type { EditorState } from "./editor"
import { where } from "./model"
import { RENDERED, type ViewerKind } from "./kind"
import { PREFS } from "./prefs"

/*
 * What one file surface shows and does: rendered or source, the editor's save state, and copy.
 * The panel and the full-size dialog each make one, so both read the same preferences.
 */

/** A file made from the header opens as source, because there is nothing to render yet. */
const [sourceFor, setSourceFor] = createSignal<string | null>(null)
export { setSourceFor }

export type FileView = ReturnType<typeof createFileView>

export function createFileView(chatId: string, path: () => string | null, file: () => FileRef | undefined, kind: () => ViewerKind) {
	const [editor, setEditor] = createSignal<EditorState>("clean")
	createEffect(on(path, () => setEditor("clean")))
	const unsaved = () => editor() === "dirty" || editor() === "saving" || editor() === "error"

	// A line asked for shows in the source, so it wins over the rendered preference until the reader toggles.
	const reveal = () => {
		const p = path()
		const r = p ? fileReveal(chatId, p) : null
		return r && r.line !== null ? { line: r.line, n: r.n } : null
	}
	const [seenReveal, setSeenReveal] = createSignal<number | null>(null)
	const mode = () => (file() ? RENDERED[kind()] : undefined)
	const rendered = () => {
		const m = mode()
		const r = reveal()
		return !!m && sourceFor() !== path() && (!r || seenReveal() === r.n) && PREFS[m][0]()
	}
	const toggleRendered = (m: keyof typeof PREFS) => {
		PREFS[m][1](!rendered())
		setSourceFor(null)
		const r = reveal()
		if (r) setSeenReveal(r.n)
	}

	const [copied, setCopied] = createSignal(false)
	let copiedTimer: ReturnType<typeof setTimeout> | undefined
	onCleanup(() => clearTimeout(copiedTimer))
	/** Copies the file's text. The clipboard gets a promise, so Safari keeps the click's permission across the fetch. */
	const copy = () => {
		const f = file()
		const p = path()
		if (!f || !p) return
		const text = readText(where(chatId, p).space, f.id, PREVIEW_BYTES).then((r) => {
			if (r.kind !== "text") throw new Error(r.kind)
			return r.text
		})
		const write =
			typeof ClipboardItem !== "undefined" && navigator.clipboard?.write
				? navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) })])
				: text.then((t) => navigator.clipboard.writeText(t))
		write.then(
			() => {
				setCopied(true)
				clearTimeout(copiedTimer)
				copiedTimer = setTimeout(() => setCopied(false), 1500)
			},
			() => showToastV2({ title: "Could not copy this file", variant: "error" }),
		)
	}

	return { editor, setEditor, unsaved, mode, rendered, toggleRendered, reveal, copied, copy }
}
