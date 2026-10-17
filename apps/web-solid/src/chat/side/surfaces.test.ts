import { describe, expect, test } from "bun:test"
import { recentFiles } from "../../files/recent"
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
    openSurface(chat, routines)
    activateSurface(chat, "memory")
    closeSurface(chat, "memory")
    expect([ids(chat), activeSurface(chat)?.id]).toEqual([["files", "routines"], "routines"])
    closeSurface(chat, "routines")
    expect([ids(chat), activeSurface(chat)?.id]).toEqual([["files"], "files"])
    closeSurface(chat, "files")
    expect([ids(chat), activeSurface(chat)]).toEqual([[], null])
  })

  test("closing a tab that is not active keeps the active one", () => {
    const chat = "chat-keep-active"
    openSurface(chat, memory)
    openSurface(chat, routines)
    closeSurface(chat, "memory")
    expect([ids(chat), activeSurface(chat)?.id]).toEqual([["routines"], "routines"])
  })

  test("closing the last tab on the right activates the left neighbor", () => {
    const chat = "chat-last"
    openSurface(chat, memory)
    openSurface(chat, routines)
    closeSurface(chat, "routines")
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
    openSurface(chat, routines)
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
    openSurface(chat, routines)
    openSurface(chat, files)
    closeOthers(chat, "files")
    expect([ids(chat), activeSurface(chat)?.id]).toEqual([["files"], "files"])
  })

  test("closeToRight removes only the tabs after the one named", () => {
    const chat = "chat-right"
    openSurface(chat, memory)
    openSurface(chat, routines)
    openSurface(chat, files)
    closeToRight(chat, "routines")
    expect(ids(chat)).toEqual(["memory", "routines"])
  })

  test("closeToRight moves the active tab back when it was removed", () => {
    const chat = "chat-right-active"
    openSurface(chat, memory)
    openSurface(chat, routines)
    openSurface(chat, files)
    closeToRight(chat, "memory")
    expect([ids(chat), activeSurface(chat)?.id]).toEqual([["memory"], "memory"])
  })
})

describe("moving tabs", () => {
  test("moveSurface reorders tabs and clamps the index", () => {
    const chat = "chat-move"
    openSurface(chat, memory)
    openSurface(chat, routines)
    openSurface(chat, files)
    moveSurface(chat, "memory", 2)
    expect(ids(chat)).toEqual(["routines", "files", "memory"])
    moveSurface(chat, "files", 0)
    expect(ids(chat)).toEqual(["files", "routines", "memory"])
    moveSurface(chat, "memory", 99)
    expect(ids(chat)).toEqual(["files", "routines", "memory"])
    moveSurface(chat, "files", -4)
    expect(ids(chat)).toEqual(["files", "routines", "memory"])
  })

  test("moveSurface keeps the active tab", () => {
    const chat = "chat-move-active"
    openSurface(chat, memory)
    openSurface(chat, routines)
    moveSurface(chat, "routines", 0)
    expect(activeSurface(chat)?.id).toBe("routines")
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
        surfaces: [{ kind: "memory" }, { kind: "file" }, { kind: "bogus" }, "memory", { kind: "routines" }],
      },
      "chat-not-object": "tabs",
    }
    store.set(KEY, JSON.stringify(saved))
    const fresh = await reload()
    expect([fresh.sidecarOpen("chat-bad"), fresh.sidecarSurfaces("chat-bad").map((s) => s.id), fresh.activeSurface("chat-bad")]).toEqual([
      true,
      ["memory", "routines"],
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
  test("Tasks shows only in a group chat", () => {
    expect(launcherEntries(false).map((e) => e.key)).toEqual(["F", "M", "R"])
    expect(launcherEntries(true).map((e) => e.key)).toEqual(["F", "M", "R", "T"])
  })

  test("the launcher rows, in order, with their letter keys", () => {
    expect(launcherEntries(true).map((e) => [e.label, e.key])).toEqual([
      ["Files", "F"],
      ["Memory", "M"],
      ["Routines", "R"],
      ["Tasks", "T"],
    ])
  })
})

describe("the launcher and file tabs", () => {
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

describe("recent files", () => {
  test("every open puts the file first, once, per chat", () => {
    openFile("chat-recent", "a.md")
    openFile("chat-recent", "b.md")
    openFile("chat-recent", "a.md", 3)
    expect(recentFiles("chat-recent")).toEqual(["a.md", "b.md"])
    expect(recentFiles("other-chat")).toEqual([])
  })
})
