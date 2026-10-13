import { expect, test } from "bun:test"
import { CELL_LIMIT, parseDelimited } from "./delimited"

test("csv fields may hold quotes, separators and line breaks", () => {
	expect(parseDelimited('a,b\n"x, y","say ""hi"""\r\n"two\nlines",z', ",")).toEqual({
		rows: [
			["a", "b"],
			["x, y", 'say "hi"'],
			["two\nlines", "z"],
		],
		cut: false,
	})
	expect(parseDelimited("a\tb\n1\t2\n", "\t").rows).toEqual([
		["a", "b"],
		["1", "2"],
	])
})

test("a byte order mark is not part of the first cell", () => {
	expect(parseDelimited("\uFEFFa,b\n1,2", ",")).toEqual(parseDelimited("a,b\n1,2", ","))
})

test("parsing stops at the row limit", () => {
	expect(parseDelimited("1\n2\n3\n4", ",", 2).rows).toEqual([["1"], ["2"]])
})

test("a cell past the cell limit is cut and says so", () => {
	const long = "x".repeat(CELL_LIMIT + 5)
	const { rows, cut } = parseDelimited(`${long},b\n1,2`, ",")
	expect(rows[0][0]).toHaveLength(CELL_LIMIT)
	expect(rows[0][1]).toBe("b")
	expect(cut).toBe(true)
	expect(parseDelimited(`${"x".repeat(CELL_LIMIT)},b`, ",").cut).toBe(false)
})
