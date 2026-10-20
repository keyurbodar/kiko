import type { FileTree } from "@pierre/trees"

type Ops = Parameters<FileTree["batch"]>[0]

export function syncTree(tree: Pick<FileTree, "batch" | "add" | "remove">, held: ReadonlySet<string>, target: ReadonlySet<string>, pending: ReadonlyMap<string, unknown>): Set<string> {
	const ops: Ops[number][] = []
	for (const path of target) if (!held.has(path)) ops.push({ type: "add", path })
	for (const path of held) if (!target.has(path) && !pending.has(path)) ops.push({ type: "remove", path, recursive: true })
	if (!ops.length) return new Set(target)
	try {
		tree.batch(ops)
	} catch {
		for (const op of ops) {
			try {
				if (op.type === "add") tree.add(op.path)
				else if (op.type === "remove") tree.remove(op.path, { recursive: true })
			} catch {
			}
		}
	}
	return new Set(target)
}
