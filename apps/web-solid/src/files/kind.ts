import type { FileRef } from "@kiko/protocol"
import { isTextFile, MAX_EDIT_BYTES } from "./api"

/*
 * Which viewer opens a file. One table, read in order: the first row that matches wins. The
 * extension decides before the stored type, because agents often store text as octet-stream.
 * No Solid and no DOM, so the cases are tested as data.
 */
export type ViewerKind = "markdown" | "json" | "csv" | "text" | "image" | "pdf" | "audio" | "video" | "other"

type FileLike = Pick<FileRef, "name" | "type" | "size">

const ext = (name: string) => /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""

const RULES: readonly [ViewerKind, (f: FileLike, e: string) => boolean][] = [
	["markdown", (f, e) => e === "md" || e === "mdx" || e === "markdown" || f.type === "text/markdown"],
	["json", (f, e) => e === "json" || e === "jsonc" || f.type === "application/json"],
	["csv", (f, e) => e === "csv" || e === "tsv" || f.type === "text/csv" || f.type === "text/tab-separated-values"],
	["pdf", (f, e) => e === "pdf" || f.type === "application/pdf"],
	["image", (f, e) => /^image\/(?!svg)/.test(f.type) || /^(png|jpe?g|gif|webp|avif|bmp|ico)$/.test(e)],
	["video", (f, e) => f.type.startsWith("video/") || /^(mp4|webm|mov|m4v|ogv)$/.test(e)],
	["audio", (f, e) => f.type.startsWith("audio/") || /^(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/.test(e)],
	["text", (f) => isTextFile(f)],
]

export function viewerKind(file: FileLike): ViewerKind {
	const e = ext(file.name)
	const kind = RULES.find(([, test]) => test(file, e))?.[0] ?? "other"
	// Text past the editor's limit would stall CodeMirror, so it is offered as a download.
	if ((kind === "text" || kind === "markdown" || kind === "json" || kind === "csv") && file.size > MAX_EDIT_BYTES) return "other"
	return kind
}

/** Kinds whose bytes are text the reader can edit and save. */
export const isEditable = (kind: ViewerKind) => kind === "text" || kind === "markdown" || kind === "json" || kind === "csv"

/** JSON indented by two spaces. Text that does not parse is shown as it is. */
export function prettyJson(text: string): string {
	try {
		return JSON.stringify(JSON.parse(text), null, 2)
	} catch {
		return text
	}
}

/**
 * Rows of a CSV or TSV. Quoted fields may hold the separator, doubled quotes and line breaks.
 * Stops after `limit` rows, so a large file draws its head at once.
 */
export function parseDelimited(text: string, separator: "," | "\t", limit = 1000): string[][] {
	const rows: string[][] = []
	let row: string[] = []
	let field = ""
	let quoted = false
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"'
				i++
			} else if (c === '"') quoted = false
			else field += c
		} else if (c === '"' && field === "") quoted = true
		else if (c === separator) {
			row.push(field)
			field = ""
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++
			row.push(field)
			rows.push(row)
			row = []
			field = ""
			if (rows.length >= limit) return rows
		} else field += c
	}
	if (field || row.length) {
		row.push(field)
		rows.push(row)
	}
	return rows
}
