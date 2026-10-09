import { expect, test } from "bun:test"
import { decodeText } from "./api"
import { parseDelimited, type ViewerKind, viewerKind } from "./kind"

test("each kind of file opens in its viewer", () => {
	const cases: [string, string, number, ViewerKind][] = [
		["notes/plan.md", "text/markdown", 10, "markdown"],
		["README.MD", "application/octet-stream", 10, "markdown"],
		["data.json", "application/octet-stream", 10, "json"],
		["rows.csv", "text/csv", 10, "csv"],
		["rows.tsv", "text/plain", 10, "csv"],
		["src/app.ts", "application/octet-stream", 10, "text"],
		["script.py", "text/x-python", 10, "text"],
		[".env", "application/octet-stream", 10, "text"],
		["icon.svg", "image/svg+xml", 10, "text"],
		["shot.png", "image/png", 10, "image"],
		["shot.jpg", "application/octet-stream", 10, "image"],
		["paper.pdf", "application/pdf", 10, "pdf"],
		["clip.mp4", "video/mp4", 10, "video"],
		["voice.ogg", "audio/ogg", 10, "audio"],
		["song.mp3", "application/octet-stream", 10, "audio"],
		["archive.zip", "application/zip", 10, "other"],
		["page.html", "application/octet-stream", 10, "html"],
		["index", "text/html", 10, "html"],
		// A large text file still opens: the preview reads its head.
		["huge.log", "application/octet-stream", 3 * 1024 * 1024, "text"],
		["huge.json", "application/json", 3 * 1024 * 1024, "json"],
	]
	for (const [name, type, , want] of cases) expect([name, viewerKind({ name, type })]).toEqual([name, want])
})

test("a preview is text, binary, or not UTF-8, and knows when it was cut", () => {
	const utf8 = (s: string) => new TextEncoder().encode(s)
	expect(decodeText(utf8("héllo"), 6)).toEqual({ kind: "text", text: "héllo", truncated: false })
	expect(decodeText(utf8("abc"), 3_000_000)).toEqual({ kind: "text", text: "abc", truncated: true })
	// A cut through "é" (two bytes) is not an encoding error: the half character is dropped.
	expect(decodeText(utf8("hé").subarray(0, 2), 3)).toEqual({ kind: "text", text: "h", truncated: true })
	expect(decodeText(new Uint8Array([104, 0, 105]), 3)).toEqual({ kind: "binary" })
	expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41]), 3)).toEqual({ kind: "not-utf8" })
	// A zero byte past the first 8 KB does not make the file binary.
	const late = new Uint8Array(9000).fill(97)
	late[8500] = 0
	expect(decodeText(late, 9000).kind).toBe("text")
})

test("csv fields may hold quotes, separators and line breaks", () => {
	expect(parseDelimited('a,b\n"x, y","say ""hi"""\r\n"two\nlines",z', ",")).toEqual([
		["a", "b"],
		["x, y", 'say "hi"'],
		["two\nlines", "z"],
	])
	expect(parseDelimited("a\tb\n1\t2\n", "\t")).toEqual([
		["a", "b"],
		["1", "2"],
	])
	expect(parseDelimited("1\n2\n3\n4", ",", 2)).toEqual([["1"], ["2"]])
})
