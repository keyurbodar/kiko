import { describe, expect, test } from "bun:test"
import {
  activateSurface,
  activeSurface,
  closeAll,
  closeOthers,
  closeSidecar,
  closeSurface,
  closeToRight,
  fileReveal,
  fileSurface,
  fixedSurface,
  launcherEntries,
  showLauncher,
  dropFileSurfaces,
  moveFileSurfaces,
  moveSurface,
  openFile,
  openSurface,
  sidecarOpen,
  sidecarSurfaces,
  toggleSidecar,
  type Surface,
} from "./surfaces"

// A plain Map stands in for the browser's localStorage. The module reads it at import and on each change.
const store = new Map<string, string>()
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
  },
})

const KEY = "kiko:sidecar:v1"
const ids = (chat: string) => sidecarSurfaces(chat).map((s) => s.id)
const memory = fixedSurface("memory")
const plate = fixedSurface("plate")
const routines = fixedSurface("routines")
const files = fixedSurface("files")

/** Imports a fresh copy of the module, the way a reload does. The query makes Bun load it again. */
let copies = 0
const reload = () => import(`./surfaces.ts?reload=${++copies}`) as Promise<typeof import("./surfaces")>

describe("opening surfaces", () => {
  test("opening the same surface twice keeps one tab", () => {
    openSurface("chat-dedupe", memory)
    openSurface("chat-dedupe", memory)
    expect(ids("chat-dedupe")).toEqual(["memory"])
    expect(activeSurface("chat-dedupe")?.id).toBe("memory")
    expect(sidecarOpen("chat-dedupe")).toBe(true)
  })

  test("opening a file twice keeps one tab and bumps the reveal counter", () => {
    openFile("chat-file", "a.md")
    const first = fileReveal("chat-file", "a.md")!
    openFile("chat-file", "a.md")
    expect(ids("chat-file")).toEqual(["file:a.md"])
    expect(fileReveal("chat-file", "a.md")!.n).toBe(first.n + 1)
  })

  test("a file reveal names its line, and only for the file asked", () => {
    openFile("chat-line", "src/app.ts", 42)
    expect(fileReveal("chat-line", "src/app.ts")!.line).toBe(42)
    expect(fileReveal("chat-line", "other.ts")).toBeNull()
    expect(fileReveal("chat-other", "src/app.ts")).toBeNull()
  })

  test("a chat with no saved state starts closed with no tabs", () => {
    expect([sidecarOpen("chat-fresh"), ids("chat-fresh"), activeSurface("chat-fresh")]).toEqual([false, [], null])
  })
})

describe("closing and activating", () => {
  test("closing the active tab activates the right neighbor, then the left, then nothing", () => {
    const chat = "chat-close"
    openSurface(chat, fixedSurface("files"))
    openSurface(chat, memory)
    openSurface(chat, plate)
    activateSurface(chat, "memory")
    closeSurface(chat, "memory")
    expect([ids(chat), activeSurface(chat)?.id]).toEqual([["files", "plate"], "plate"])
    closeSurface(chat, "plate")
    expect([ids(chat), activeSurface(chat)?.id]).toEqual([["files"], "files"])
    closeSurface(chat, "files")
    expect([ids(chat), activeSurface(chat)]).toEqual([[], null])
  })

  test("closing a tab that is not active keeps the active one", () => {
    const chat = "chat-keep-active"
    openSurface(chat, memory)
    openSurface(chat, plate)
    closeSurface(chat, "memory")
    expect([ids(chat), activeSurface(chat)?.id]).toEqual([["plate"], "plate"])
  })

  test("closing the last tab on the right activates the left neighbor", () => {
    const chat = "chat-last"
    openSurface(chat, memory)
    openSurface(chat, plate)
    closeSurface(chat, "plate")
    expect(activeSurface(chat)?.id).toBe("memory")
  })

  test("activating a tab that is not open changes nothing", () => {
    const chat = "chat-activate"
    openSurface(chat, memory)
    activateSurface(chat, "routines")
    expect(activeSurface(chat)?.id).toBe("memory")
  })

  test("closeAll keeps the sidecar open with no tab active", () => {
    const chat = "chat-closeall"
    openSurface(chat, memory)
    openSurface(chat, plate)
    closeAll(chat)
    expect([sidecarOpen(chat), ids(chat), activeSurface(chat)]).toEqual([true, [], null])
  })

  test("closeSidecar hides the column and keeps its tabs for next time", () => {
    const chat = "chat-hide"
    openSurface(chat, memory)
    closeSidecar(chat)
    expect([sidecarOpen(chat), ids(chat), activeSurface(chat)?.id]).toEqual([false, ["memory"], "memory"])
    toggleSidecar(chat)
    expect(sidecarOpen(chat)).toBe(true)
  })

  test("closeOthers keeps one tab and activates it", () => {
    const chat = "chat-others"
    openSurface(chat, memory)
    openSurface(chat, plate)
    openSurface(chat, routines)
    closeOthers(chat, "plate")
    expect([ids(chat), activeSurface(chat)?.id]).toEqual([["plate"], "plate"])
  })

  test("closeToRight removes only the tabs after the one named", () => {
    const chat = "chat-right"
    openSurface(chat, memory)
    openSurface(chat, plate)
    openSurface(chat, routines)
    closeToRight(chat, "plate")
    expect(ids(chat)).toEqual(["memory", "plate"])
  })

  test("closeToRight moves the active tab back when it was removed", () => {
    const chat = "chat-right-active"
    openSurface(chat, memory)
    openSurface(chat, plate)
    openSurface(chat, routines)
    closeToRight(chat, "memory")
    expect([ids(chat), activeSurface(chat)?.id]).toEqual([["memory"], "memory"])
  })
})

describe("moving tabs", () => {
  test("moveSurface reorders tabs and clamps the index", () => {
    const chat = "chat-move"
    openSurface(chat, memory)
    openSurface(chat, plate)
    openSurface(chat, routines)
    moveSurface(chat, "memory", 2)
    expect(ids(chat)).toEqual(["plate", "routines", "memory"])
    moveSurface(chat, "routines", 0)
    expect(ids(chat)).toEqual(["routines", "plate", "memory"])
    moveSurface(chat, "memory", 99)
    expect(ids(chat)).toEqual(["routines", "plate", "memory"])
    moveSurface(chat, "routines", -4)
    expect(ids(chat)).toEqual(["routines", "plate", "memory"])
  })

  test("moveSurface keeps the active tab", () => {
    const chat = "chat-move-active"
    openSurface(chat, memory)
    openSurface(chat, plate)
    moveSurface(chat, "plate", 0)
    expect(activeSurface(chat)?.id).toBe("plate")
  })
})

describe("saved state", () => {
  test("state survives a reload, with its order, open flag, and active tab", async () => {
    const chat = "chat-reload"
    openSurface(chat, memory)
    openSurface(chat, fileSurface("notes/plan.md"))
    moveSurface(chat, "memory", 1)
    activateSurface(chat, "memory")
    closeSidecar(chat)

    const fresh = await reload()
    expect(fresh.sidecarOpen(chat)).toBe(false)
    expect(fresh.sidecarSurfaces(chat).map((s) => s.id)).toEqual(["file:notes/plan.md", "memory"])
    expect(fresh.activeSurface(chat)?.id).toBe("memory")
  })

  test("corrupt JSON is ignored and the chat starts closed", async () => {
    store.set(KEY, "{not json")
    const fresh = await reload()
    expect([fresh.sidecarOpen("chat-reload"), fresh.sidecarSurfaces("chat-reload")]).toEqual([false, []])
    store.delete(KEY)
  })

  test("entries that do not match the model are dropped, and a bad active id is cleared", async () => {
    const saved = {
      "chat-bad": {
        open: true,
        active: "file:gone.md",
        surfaces: [{ kind: "memory" }, { kind: "file" }, { kind: "bogus" }, "memory", { kind: "plate" }],
      },
      "chat-not-object": "tabs",
    }
    store.set(KEY, JSON.stringify(saved))
    const fresh = await reload()
    expect([fresh.sidecarOpen("chat-bad"), fresh.sidecarSurfaces("chat-bad").map((s) => s.id), fresh.activeSurface("chat-bad")]).toEqual([
      true,
      ["memory", "plate"],
      null,
    ])
    expect(fresh.sidecarOpen("chat-not-object")).toBe(false)
    store.delete(KEY)
  })

  test("a change is written to localStorage", () => {
    openSurface("chat-write", routines)
    const saved = JSON.parse(store.get(KEY)!) as Record<string, { surfaces: Surface[] }>
    expect(saved["chat-write"]!.surfaces.map((s) => s.id)).toEqual(["routines"])
  })
})

describe("launcher", () => {
  test("Tasks is disabled in a single chat and enabled in a group", () => {
    const single = launcherEntries(false)
    const group = launcherEntries(true)
    expect(single.map((e) => [e.key, e.disabled])).toEqual([
      ["F", undefined],
      ["M", undefined],
      ["P", undefined],
      ["R", undefined],
      ["T", "Only in group chats"],
    ])
    expect(group.find((e) => e.key === "T")!.disabled).toBeUndefined()
  })

  test("the launcher rows, in order, with their letter keys", () => {
    expect(launcherEntries(true).map((e) => [e.label, e.key])).toEqual([
      ["Files", "F"],
      ["Memory", "M"],
      ["On your plate", "P"],
      ["Routines", "R"],
      ["Tasks", "T"],
    ])
  })
})

describe("the launcher and file tabs", () => {
  test("showLauncher clears the active tab and keeps the tabs", () => {
    const chat = "chat-launcher"
    openSurface(chat, memory)
    openSurface(chat, plate)
    showLauncher(chat)
    expect([ids(chat), activeSurface(chat), sidecarOpen(chat)]).toEqual([["memory", "plate"], null, true])
  })

  test("a rename moves the file tabs under it, keeps the active one, and leaves others alone", () => {
    const chat = "chat-rename"
    openFile(chat, "docs/a.md")
    openFile(chat, "docs/deep/b.md")
    openSurface(chat, memory)
    openFile(chat, "other.md")
    activateSurface(chat, "file:docs/deep/b.md")
    moveFileSurfaces(chat, "docs", "notes")
    expect([ids(chat), activeSurface(chat)?.id]).toEqual([["file:notes/a.md", "file:notes/deep/b.md", "memory", "file:other.md"], "file:notes/deep/b.md"])
  })

  test("a rename onto an open tab keeps one tab", () => {
    const chat = "chat-rename-dupe"
    openFile(chat, "a/x.md")
    openFile(chat, "b/x.md")
    moveFileSurfaces(chat, "a", "b")
    expect(ids(chat)).toEqual(["file:b/x.md"])
  })

  test("a delete closes the file tabs at the path or under it", () => {
    const chat = "chat-drop"
    openFile(chat, "notes/a.md")
    openFile(chat, "notes/deep/b.md")
    openFile(chat, "notes2/c.md")
    openSurface(chat, memory)
    dropFileSurfaces(chat, "notes")
    expect([ids(chat), activeSurface(chat)?.id]).toEqual([["file:notes2/c.md", "memory"], "memory"])
  })
})
