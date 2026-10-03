import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// The chat's files as agents use them: pi-durable's read, write, and edit, and kiko's ls, rm, mv,
// and cp, against the real RoomDO and real R2 in workerd (room-fs-worker.ts).
let mf: Miniflare
let origin: string

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./room-fs-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { ROOM: { className: "RoomDO", useSQLite: true }, USER: { className: "UserDO", useSQLite: true } },
    r2Buckets: ["FILES"],
  })
  origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
  await mf?.dispose()
})

let n = 0
const fresh = () => `01JZ8Q4T6F${String(++n).padStart(16, "0")}`
type Out = { ok: boolean; text: string; notes: string; ms: number }

function agent(room: string, slug = "ada") {
  const run = async (name: string, args: Record<string, unknown>): Promise<Out> => {
    const res = await fetch(`${origin}/tool/${room}/${slug}`, { method: "POST", body: JSON.stringify({ name, args }) })
    return (await res.json()) as Out
  }
  return {
    run,
    write: (path: string, content: string) => run("write", { path, content }),
    read: async (path: string) => (await run("read", { path })).text,
    ls: async (path = "/", recursive = false) => (await run("ls", { path, recursive })).text,
  }
}
const keys = async (room: string) => (await (await fetch(`${origin}/keys/${room}`)).json()) as string[]
const human = async (room: string, op: unknown) => ((await (await fetch(`${origin}/op/${room}`, { method: "POST", body: JSON.stringify(op) })).json()) as { refused: string | null }).refused

test("write makes folders, read gives text back, ls shows folders and files", async () => {
  const a = agent(fresh())
  expect((await a.write("notes/plan.md", "# plan\nstep one\n")).ok).toBe(true)
  await a.write("/notes/deep/idea.txt", "x")
  await a.write("readme.md", "hi")
  expect(await a.read("notes/plan.md")).toBe("# plan\nstep one\n")
  expect(await a.read("/notes/../notes/plan.md")).toBe("# plan\nstep one\n")
  expect(await a.ls()).toBe("/notes/\t2 files, 17 b\n/readme.md\t2 b\ttext/markdown")
  expect(await a.ls("notes")).toBe("/notes/deep/\t1 files, 1 b\n/notes/plan.md\t16 b\ttext/markdown")
  expect(await a.ls("/", true)).toBe("/notes/deep/idea.txt\t1 b\ttext/plain\n/notes/plan.md\t16 b\ttext/markdown\n/readme.md\t2 b\ttext/markdown")
})

test("read takes an offset and a limit, as pi's read does", async () => {
  const a = agent(fresh())
  await a.write("lines.txt", Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n"))
  const out = await a.run("read", { path: "lines.txt", offset: 3, limit: 2 })
  expect(out.text).toBe("line 3\nline 4")
  expect(out.notes).toContain("offset=5")
})

test("edit replaces exact unique text, as pi core's edit does, and refuses a missing or repeated match", async () => {
  const a = agent(fresh())
  await a.write("app.ts", "const a = 1\nconst b = 2\nconst b = 2\n")
  const one = await a.run("edit", { path: "app.ts", edits: [{ oldText: "const a = 1", newText: "const a = 10" }] })
  expect(one.ok).toBe(true)
  expect(await a.read("app.ts")).toBe("const a = 10\nconst b = 2\nconst b = 2\n")
  const twice = await a.run("edit", { path: "app.ts", edits: [{ oldText: "const b = 2", newText: "x" }] })
  expect(twice.ok).toBe(false)
  const missing = await a.run("edit", { path: "app.ts", edits: [{ oldText: "nope", newText: "x" }] })
  expect(missing.ok).toBe(false)
  // Two edits in one call, each matched against the original.
  const multi = await a.run("edit", { path: "app.ts", edits: [{ oldText: "const a = 10\n", newText: "" }, { oldText: "const b = 2\nconst b = 2", newText: "const b = 3" }] })
  expect(multi.ok).toBe(true)
  expect(await a.read("app.ts")).toBe("const b = 3\n")
})

test("a write never overwrites a teammate's change it did not read; an edit applies on top of it", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const bob = agent(room, "bob")
  await ada.write("doc.md", "alpha\nbeta\n")
  expect(await bob.read("doc.md")).toBe("alpha\nbeta\n")
  await ada.run("edit", { path: "doc.md", edits: [{ oldText: "alpha", newText: "ALPHA" }] })
  // bob rewrites the whole file from what he read: ada's change would be lost, so it is refused.
  const stale = await bob.write("doc.md", "alpha\nBETA\n")
  expect(stale.ok).toBe(false)
  expect(stale.text).toContain("changed since you last read it")
  expect(await ada.read("doc.md")).toBe("ALPHA\nbeta\n")
  // An edit reads the file itself, so it lands on top of ada's change.
  expect((await bob.run("edit", { path: "doc.md", edits: [{ oldText: "beta", newText: "BETA" }] })).ok).toBe(true)
  expect(await ada.read("doc.md")).toBe("ALPHA\nBETA\n")
  // A write to a file this agent never read is a plain overwrite, as on linux.
  expect((await agent(room, "cy").write("doc.md", "fresh")).ok).toBe(true)
})

test("mv renames, moves into a folder, moves a whole folder, and replaces a file, as on linux", async () => {
  const room = fresh()
  const a = agent(room)
  await a.write("a.md", "a")
  await a.write("docs/b.md", "b")
  await a.write("docs/sub/c.md", "c")
  expect((await a.run("mv", { from: "a.md", to: "renamed.md" })).text).toBe("moved a.md to renamed.md")
  expect((await a.run("mv", { from: "renamed.md", to: "docs" })).text).toBe("moved renamed.md to docs/renamed.md")
  expect(await a.read("docs/renamed.md")).toBe("a")
  expect((await a.run("mv", { from: "docs", to: "archive/2026" })).ok).toBe(true)
  expect(await a.ls("/", true)).toBe("/archive/2026/b.md\t1 b\ttext/markdown\n/archive/2026/renamed.md\t1 b\ttext/markdown\n/archive/2026/sub/c.md\t1 b\ttext/markdown")
  // A file onto a file replaces it, and the replaced bytes leave R2.
  const before = (await keys(room)).length
  await a.write("x.md", "new")
  expect((await a.run("mv", { from: "x.md", to: "archive/2026/b.md" })).ok).toBe(true)
  expect(await a.read("archive/2026/b.md")).toBe("new")
  await Bun.sleep(100)
  expect((await keys(room)).length).toBe(before)
  // Never into itself, never a folder onto something that exists, never from nothing.
  expect((await a.run("mv", { from: "archive", to: "archive/inner" })).ok).toBe(false)
  await a.write("taken/f.md", "f")
  expect((await a.run("mv", { from: "archive/2026", to: "taken" })).text).toBe("moved archive/2026 to taken/2026")
  expect((await a.run("mv", { from: "nothing.md", to: "y.md" })).ok).toBe(false)
})

test("rm deletes files and, with recursive, folders; a refusal deletes nothing; R2 is cleaned", async () => {
  const room = fresh()
  const a = agent(room)
  await a.write("keep.md", "k")
  await a.write("tmp/one.md", "1")
  await a.write("tmp/two/three.md", "3")
  expect((await a.run("rm", { paths: ["tmp"] })).text).toContain("is a folder")
  expect((await a.run("rm", { paths: ["keep.md", "missing.md"] })).ok).toBe(false)
  expect(await a.read("keep.md")).toBe("k")
  expect((await a.run("rm", { paths: ["tmp"], recursive: true })).text).toBe("deleted 2 files")
  expect((await a.run("rm", { paths: ["keep.md"] })).text).toBe("deleted 1 file")
  expect(await a.ls()).toBe("no files yet")
  await Bun.sleep(100)
  expect(await keys(room)).toEqual([])
})

test("cp copies a file, and a folder with recursive", async () => {
  const a = agent(fresh())
  await a.write("src/a.md", "a")
  await a.write("src/b/c.md", "c")
  expect((await a.run("cp", { from: "src/a.md", to: "a-copy.md" })).ok).toBe(true)
  expect((await a.run("cp", { from: "src", to: "dst" })).text).toContain("recursive")
  expect((await a.run("cp", { from: "src", to: "dst", recursive: true })).text).toBe("copied 2 files to dst")
  expect(await a.read("dst/b/c.md")).toBe("c")
  expect(await a.read("src/b/c.md")).toBe("c")
})

test("paths stay inside the chat, and a file and a folder never share a name", async () => {
  const a = agent(fresh())
  for (const path of ["../secret", "/../x", "a/../../x"]) expect((await a.write(path, "x")).ok).toBe(false)
  await a.write("doc.md", "d")
  expect((await a.write("doc.md/inner.md", "x")).text).toContain("is a file")
  await a.write("dir/f.md", "f")
  expect((await a.write("dir", "x")).text).toContain("is a folder")
  expect((await a.run("read", { path: "dir" })).text).toContain("is a folder")
  expect(await a.ls()).toBe("/dir/\t1 files, 1 b\n/doc.md\t1 b\ttext/markdown")
})

test("the human's rm and mv go through the same rules", async () => {
  const room = fresh()
  const a = agent(room)
  await a.write("notes/a.md", "a")
  expect(await human(room, { op: "rm", paths: ["notes"] })).toContain("is a folder")
  expect(await human(room, { op: "mv", from: "notes", to: "kept" })).toBeNull()
  expect(await a.ls()).toBe("/kept/\t1 files, 1 b")
  expect(await human(room, { op: "rm", paths: ["kept"], recursive: true })).toBeNull()
  expect(await human(room, { op: "rm", paths: ["../x"] })).not.toBeNull()
  expect(await a.ls()).toBe("no files yet")
})

const raw = (room: string, path: string, type: string, bytes: Uint8Array) =>
  fetch(`${origin}/raw/${room}?path=${encodeURIComponent(path)}&type=${encodeURIComponent(type)}`, { method: "POST", body: bytes })

test("read gives an image to a model that sees images, a pdf as text, and refuses a binary file", async () => {
  const room = fresh()
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])
  await raw(room, "attachments/pic.png", "image/png", png)
  expect(await agent(room, "seer").read("attachments/pic.png")).toBe("[image]")
  expect(await agent(room, "ada").read("attachments/pic.png")).toBe("attachments/pic.png is an image (image/png, 7 b). this model cannot read images.")
  const pdf = new Uint8Array(await Bun.file(new URL("./fixtures/hello.pdf", import.meta.url)).arrayBuffer())
  await raw(room, "attachments/trip.pdf", "application/pdf", pdf)
  const read = await agent(room).read("/attachments/trip.pdf")
  expect(read).toContain("a pdf of 1 pages")
  expect(read).toContain("kiko reads pdfs: lisbon trip plan")
  await raw(room, "blob.bin", "application/octet-stream", new Uint8Array([1, 0, 2]))
  const bin = await agent(room).run("read", { path: "blob.bin" })
  expect(bin.ok).toBe(false)
  expect(bin.text).toContain("binary")
})

test("speed: a read is one room call and one R2 read; an edit after it reads nothing again", async () => {
  const room = fresh()
  const a = agent(room)
  await a.write("big.md", `title\n${"line\n".repeat(2000)}`)
  const counts = async () => (await (await fetch(`${origin}/counts/${room}/ada`)).json()) as { stat: number; get: number; put: number }
  await Bun.sleep(1_100)
  await counts()
  await a.read("big.md")
  expect(await counts()).toEqual({ stat: 1, get: 0, put: 0 })
  await Bun.sleep(1_100)
  expect((await a.run("edit", { path: "big.md", edits: [{ oldText: "title\n", newText: "head\n" }] })).ok).toBe(true)
  // The bytes came from the cache: the object at a key never changes.
  expect(await counts()).toEqual({ stat: 1, get: 0, put: 1 })
})
