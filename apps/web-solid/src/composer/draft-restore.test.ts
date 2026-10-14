import { expect, test } from "bun:test"
import type { DraftFile } from "./rich/draft-files"
import { createDraftRestore } from "./draft-restore"

const file = (id: string): DraftFile => ({ id, name: `${id}.txt`, type: "text/plain", size: 1, blob: new Blob(["x"]) })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

/** A box that records every part the restore applied, as the composer does. */
function harness() {
  const box = new Set<string>()
  let open: string | undefined = "chat-a"
  const applied: string[] = []
  const released: string[] = []
  const lists = new Map<string, ReturnType<typeof deferred<DraftFile[]>>>()
  const restore = createDraftRestore<{ id: string }>({
    list: (key) => {
      const pending = deferred<DraftFile[]>()
      lists.set(`${key}#${lists.size}`, pending)
      return pending.promise
    },
    current: () => open,
    inBox: () => box,
    build: async (saved) => ({ id: saved.id }),
    release: (item) => released.push(item.id),
    apply: (_key, items) => {
      for (const item of items) {
        box.add(item.id)
        applied.push(item.id)
      }
    },
  })
  return {
    box,
    applied,
    released,
    leave: () => (open = undefined),
    /** Resolves the nth list call, so a test can finish restores in any order. */
    answer: (n: number, files: DraftFile[]) => [...lists.values()][n]!.resolve(files),
    restore,
  }
}

test("two overlapping restores of one chat add each file once, whichever finishes first", async () => {
  const h = harness()
  const first = h.restore("chat-a")
  const second = h.restore("chat-a")
  h.answer(1, [file("one"), file("two")])
  h.answer(0, [file("one"), file("two")])
  await Promise.all([first, second])
  expect(h.applied.sort()).toEqual(["one", "two"])
  expect(h.box.size).toBe(2)
})

test("a file already in the box is not added again on a later restore", async () => {
  const h = harness()
  h.box.add("one")
  const restore = h.restore("chat-a")
  h.answer(0, [file("one"), file("two")])
  await restore
  expect(h.applied).toEqual(["two"])
})

test("a restore that finishes after the user left the chat adds nothing and releases what it built", async () => {
  const h = harness()
  const restore = h.restore("chat-a")
  h.leave()
  h.answer(0, [file("one")])
  await restore
  expect(h.applied).toEqual([])
  expect(h.released).toEqual(["one"])
})
