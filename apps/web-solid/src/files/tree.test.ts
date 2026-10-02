import { describe, expect, test } from "bun:test"
import { buildIndex, isHidden, loadExpanded, pathsUnder, saveExpanded, type KeyValueStore } from "./model"

describe("buildIndex", () => {
	test("folders first, then files, each by name", () => {
		const { children, folders } = buildIndex(["b.txt", "src/z.ts", "a.txt", "src/a.ts", "docs/x.md"])
		expect(children.get("")).toEqual(["docs", "src", "a.txt", "b.txt"])
		expect(children.get("src")).toEqual(["src/a.ts", "src/z.ts"])
		expect([...folders].sort()).toEqual(["docs", "src"])
	})
	test("nested paths create every parent", () => {
		const { children } = buildIndex(["a/b/c/d.txt"])
		expect(children.get("")).toEqual(["a"])
		expect(children.get("a")).toEqual(["a/b"])
		expect(children.get("a/b/c")).toEqual(["a/b/c/d.txt"])
	})
	test("numbers sort naturally", () => {
		expect(buildIndex(["f10.txt", "f2.txt"]).children.get("")).toEqual(["f2.txt", "f10.txt"])
	})
	test("empty folders show, a leading slash is ignored", () => {
		const { children } = buildIndex(["/a.txt"], ["new/inner"])
		expect(children.get("")).toEqual(["new", "a.txt"])
		expect(children.get("new")).toEqual(["new/inner"])
	})
	test("a folder wins over a file with the same path", () => {
		const { folders, children } = buildIndex(["a", "a/b.txt"])
		expect(folders.has("a")).toBe(true)
		expect(children.get("")).toEqual(["a"])
	})
})

describe("isHidden", () => {
	for (const [path, hidden] of [
		[".env", true],
		["src/.cache/x.js", true],
		["src/main.ts", false],
		["a.b/c.txt", false],
	] as const) {
		test(path, () => expect(isHidden(path)).toBe(hidden))
	}
})

test("pathsUnder matches the folder and not a sibling prefix", () => {
	expect(pathsUnder(["a/x", "a/b/y", "ab/z", "a"], "a").sort()).toEqual(["a", "a/b/y", "a/x"])
})

describe("expanded persistence", () => {
	const memory = (): KeyValueStore & { data: Map<string, string> } => {
		const data = new Map<string, string>()
		return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
	}
	test("each room keeps its own set", () => {
		const s = memory()
		saveExpanded("r1", s, ["a", "a/b"])
		saveExpanded("r2", s, ["z"])
		expect(loadExpanded("r1", s)).toEqual(["a", "a/b"])
		expect(loadExpanded("r2", s)).toEqual(["z"])
		expect(loadExpanded("r3", s)).toEqual([])
	})
	test("bad data and a missing store give an empty set", () => {
		const s = memory()
		s.data.set("kiko:files:expanded:r1", "{nope")
		expect(loadExpanded("r1", s)).toEqual([])
		expect(loadExpanded("r1", undefined)).toEqual([])
		s.data.set("kiko:files:expanded:r1", JSON.stringify(["a", 3]))
		expect(loadExpanded("r1", s)).toEqual(["a"])
	})
	test("a store that throws does not break saving", () => {
		const bad: KeyValueStore = {
			getItem: () => null,
			setItem: () => {
				throw new Error("quota")
			},
		}
		expect(() => saveExpanded("r", bad, ["a"])).not.toThrow()
	})
})
