import type { AgentSlug, FileRef, OwnerFile, RoomId } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { mergeLibrary } from "./library-model"

const A = "00000000-0000-7000-8000-00000000000a" as RoomId
const B = "00000000-0000-7000-8000-00000000000b" as RoomId
const GONE = "00000000-0000-7000-8000-00000000000c" as RoomId

const ref = (id: string, name: string): FileRef => ({ id, name, size: 1, type: "text/plain" }) as FileRef
const listed = (roomId: RoomId | null, file: FileRef, madeBy: string | null, at: number): OwnerFile =>
  ({ roomId, file, madeBy: madeBy as AgentSlug | null, at }) as OwnerFile

describe("mergeLibrary", () => {
  it("lists home, the open chat and every other chat's files, with who made each", () => {
    const notes = ref("n", "notes.md")
    const plan = ref("p", "plan.md")
    const live = ref("l", "draft.md")
    const merged = mergeLibrary({
      listed: [
        listed(null, notes, null, 3),
        listed(B, plan, "juno", 2),
        listed(A, ref("old", "draft.md"), "kiko", 1),
        listed(GONE, ref("g", "gone.md"), null, 1),
        listed(B, ref("h", ".hidden/x.md"), null, 1),
      ],
      home: [notes],
      activeId: A,
      active: [live],
      chats: new Set([A, B]),
    })
    expect(merged.map((f) => [f.space, f.path, f.madeBy])).toEqual([
      ["home", "home/notes.md", null],
      [A, "draft.md", null],
      [B, "plan.md", "juno"],
    ])
    expect(new Set(merged.map((f) => f.key)).size).toBe(merged.length)
  })

  it("treats a file the listing has not seen yet as the newest", () => {
    const [file] = mergeLibrary({
      listed: [],
      home: [ref("x", "new.md")],
      activeId: null,
      active: [],
      chats: new Set(),
    })
    expect(file?.at).toBe(Number.MAX_SAFE_INTEGER)
  })
})
