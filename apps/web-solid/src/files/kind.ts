import type { FileRef } from "@kiko/protocol"
import { isTextFile } from "./api"

/*
 * Which viewer opens a file, after t3code's filePreviewKind. One table, read in order: the first
 * row that matches wins. A row matches on the stored type or the extension, because agents often
 * store text as octet-stream. No Solid and no DOM, so the cases are tested as data.
 */
export type ViewerKind = "markdown" | "json" | "csv" | "html" | "text" | "image" | "pdf" | "audio" | "video" | "other"

/** The kinds read as text. Each shows its source, and some have a rendered view too. */
export const TEXT_KINDS: ReadonlySet<ViewerKind> = new Set(["markdown", "json", "csv", "html", "text"])
/** The kinds with a rendered view, and what that view is. */
export const RENDERED: Partial<Record<ViewerKind, "markdown" | "table" | "html">> = { markdown: "markdown", csv: "table", html: "html" }

type FileLike = Pick<FileRef, "name" | "type">

const ext = (name: string) => /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""

const RULES: readonly [ViewerKind, (f: FileLike, e: string) => boolean][] = [
	["markdown", (f, e) => e === "md" || e === "mdx" || e === "markdown" || f.type === "text/markdown"],
	["json", (f, e) => e === "json" || e === "jsonc" || f.type === "application/json"],
	["csv", (f, e) => e === "csv" || e === "tsv" || f.type === "text/csv" || f.type === "text/tab-separated-values"],
	["html", (f, e) => e === "html" || e === "htm" || f.type === "text/html"],
	["pdf", (f, e) => e === "pdf" || f.type === "application/pdf"],
	["image", (f, e) => /^image\/(?!svg)/.test(f.type) || /^(png|jpe?g|gif|webp|avif|bmp|ico)$/.test(e)],
	["video", (f, e) => f.type.startsWith("video/") || /^(mp4|webm|mov|m4v|ogv)$/.test(e)],
	["audio", (f, e) => f.type.startsWith("audio/") || /^(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/.test(e)],
	["text", (f) => isTextFile(f)],
]

export function viewerKind(file: FileLike): ViewerKind {
	const e = ext(file.name)
	return RULES.find(([, test]) => test(file, e))?.[0] ?? "other"
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
