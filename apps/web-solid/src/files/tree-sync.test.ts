import { describe, expect, test } from "bun:test"
import { FileTree } from "@pierre/trees"
import { syncTree } from "./tree-sync"

const make = (paths: string[]) => new FileTree({ paths, flattenEmptyDirectories: true, initialExpansion: "open" })
const has = (tree: FileTree, ...paths: string[]) => paths.map((p) => tree.getItem(p) !== null)
const set = (...paths: string[]) => new Set(paths)

describe("syncTree", () => {
	test("a rename the tree already made does not strand the rest of the update", () => {
		const tree = make(["a/x.txt", "keep.txt"])
		tree.move("a/x.txt", "a/y.txt")
		const held = syncTree(tree, set("a/x.txt", "keep.txt"), set("a/y.txt", "keep.txt", "agent.txt"), new Map())
		expect(has(tree, "a/y.txt", "a/x.txt", "agent.txt")).toEqual([true, false, true])
		expect([...held].sort()).toEqual(["a/y.txt", "agent.txt", "keep.txt"])
	})
	test("a path the tree lost already is not removed again", () => {
		const tree = make(["a/x.txt", "b.txt"])
		tree.remove("a/x.txt")
		syncTree(tree, set("a/x.txt", "b.txt"), set("b.txt", "c.txt"), new Map())
		expect(has(tree, "b.txt", "c.txt")).toEqual([true, true])
	})
	test("a folder added twice does not throw", () => {
		const tree = make(["a.txt"])
		tree.add("new/")
		expect(() => syncTree(tree, set("a.txt"), set("a.txt", "new/"), new Map())).not.toThrow()
	})
	test("a pending row stays until its create is answered", () => {
		const tree = make(["a.txt"])
		tree.add("untitled")
		syncTree(tree, set("a.txt", "untitled"), set("a.txt"), new Map([["untitled", "file"]]))
		expect(has(tree, "untitled")).toEqual([true])
	})
	test("a removed folder takes its files with it", () => {
		const tree = make(["d/x.txt", "d/y.txt", "z.txt"])
		syncTree(tree, set("d/x.txt", "d/y.txt", "d/", "z.txt"), set("z.txt"), new Map())
		expect(has(tree, "d/x.txt", "d/", "z.txt")).toEqual([false, false, true])
	})
})
