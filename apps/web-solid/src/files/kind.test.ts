import { expect, test } from "bun:test"
import { parseDelimited, prettyJson, type ViewerKind, viewerKind } from "./kind"

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
		["huge.log.txt", "text/plain", 3 * 1024 * 1024, "other"],
		["huge.json", "application/json", 3 * 1024 * 1024, "other"],
	]
	for (const [name, type, size, want] of cases) expect([name, viewerKind({ name, type, size })]).toEqual([name, want])
})

test("json is indented, and text that is not json is left alone", () => {
	expect(prettyJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}')
	expect(prettyJson("{oops")).toBe("{oops")
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
