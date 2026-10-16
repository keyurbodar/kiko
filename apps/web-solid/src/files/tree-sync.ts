import type { FileTree } from "@pierre/trees"

type Ops = Parameters<FileTree["batch"]>[0]

/**
 * Brings the tree to `target`, the paths the room now shows. `held` is what the last call left in
 * it. The tree may already have a change the room has not echoed yet (a rename moves a row at once),
 * and it refuses an add of a path it holds and a remove of one it lacks. One refused op must not
 * strand the rest, so a failed batch is replayed one op at a time. A pending row stays until its
 * create is answered.
 */
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
				// The tree already has it, or already lost it.
			}
		}
	}
	return new Set(target)
}
