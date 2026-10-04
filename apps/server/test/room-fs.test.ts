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
/** A root listing without the mounts, /me and /home. */
const chatOnly = (listing: string) =>
  listing
    .split("\n")
    .filter((l) => !l.startsWith("/me/") && !l.startsWith("/home/"))
    .join("\n")
const keys = async (room: string) => (await (await fetch(`${origin}/keys/${room}`)).json()) as string[]
const human = async (room: string, op: unknown) => ((await (await fetch(`${origin}/op/${room}`, { method: "POST", body: JSON.stringify(op) })).json()) as { refused: string | null }).refused

test("write makes folders, read gives text back, ls shows folders and files", async () => {
  const a = agent(fresh())
  expect((await a.write("notes/plan.md", "# plan\nstep one\n")).ok).toBe(true)
  await a.write("/notes/deep/idea.txt", "x")
  await a.write("readme.md", "hi")
  expect(await a.read("notes/plan.md")).toBe("# plan\nstep one\n")
  expect(await a.read("/notes/../notes/plan.md")).toBe("# plan\nstep one\n")
  expect(chatOnly(await a.ls())).toBe("/notes/\t2 files, 17 b\n/readme.md\t2 b\ttext/markdown")
  expect(await a.ls("notes")).toBe("/notes/deep/\t1 files, 1 b\n/notes/plan.md\t16 b\ttext/markdown")
  expect(chatOnly(await a.ls("/", true))).toBe(
    "/notes/\t2 files, 17 b\n/notes/deep/\t1 files, 1 b\n/notes/deep/idea.txt\t1 b\ttext/plain\n/notes/plan.md\t16 b\ttext/markdown\n/readme.md\t2 b\ttext/markdown",
  )
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
  // While ada's run lasts, the file is hers: bob is told who holds it.
  const held = await bob.write("doc.md", "alpha\nBETA\n")
  expect(held.ok).toBe(false)
  expect(held.text).toContain("@ada is working on /doc.md right now (editing /doc.md)")
  await fetch(`${origin}/idle/${room}/ada`)
  // Once she is done, bob rewriting the whole file from what he read would lose her change: refused.
  const stale = await bob.write("doc.md", "alpha\nBETA\n")
  expect(stale.ok).toBe(false)
  expect(stale.text).toContain("changed since you last read it")
  expect(await ada.read("doc.md")).toBe("ALPHA\nbeta\n")
  // An edit reads the file itself, so it lands on top of ada's change.
  expect((await bob.run("edit", { path: "doc.md", edits: [{ oldText: "beta", newText: "BETA" }] })).ok).toBe(true)
  expect(await ada.read("doc.md")).toBe("ALPHA\nBETA\n")
  // Held by bob now; once his run ends, a write by an agent that never read it is a plain overwrite, as on linux.
  expect((await agent(room, "cy").write("doc.md", "fresh")).text).toContain("@bob is working on /doc.md")
  await fetch(`${origin}/idle/${room}/bob`)
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
  expect(chatOnly(await a.ls("/", true))).toBe("/archive/\t3 files, 3 b\n/archive/2026/\t3 files, 3 b\n/archive/2026/sub/\t1 files, 1 b\n/archive/2026/b.md\t1 b\ttext/markdown\n/archive/2026/renamed.md\t1 b\ttext/markdown\n/archive/2026/sub/c.md\t1 b\ttext/markdown")
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
  expect((await a.run("rm", { paths: ["tmp"], recursive: true })).text).toBe("deleted 2 files and 2 folders")
  expect((await a.run("rm", { paths: ["keep.md"] })).text).toBe("deleted 1 file")
  expect(chatOnly(await a.ls())).toBe("")
  await Bun.sleep(100)
  expect(await keys(room)).toEqual([])
})

test("rm -r of a folder with more files than one query may bind (100) deletes them all", async () => {
  const room = fresh()
  const a = agent(room)
  await Promise.all(Array.from({ length: 150 }, (_, i) => a.write(`big/f${i}.md`, String(i))))
  const out = await a.run("rm", { paths: ["big"], recursive: true })
  expect(out.ok).toBe(true)
  expect(out.text).toBe("deleted 150 files and 1 folder")
  expect(chatOnly(await a.ls())).toBe("")
}, 60_000)

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
  expect(chatOnly(await a.ls())).toBe("/dir/\t1 files, 1 b\n/doc.md\t1 b\ttext/markdown")
})

test("the human's rm and mv go through the same rules", async () => {
  const room = fresh()
  const a = agent(room)
  await a.write("notes/a.md", "a")
  expect(await human(room, { op: "rm", paths: ["notes"] })).toContain("is a folder")
  expect(await human(room, { op: "mv", from: "notes", to: "kept" })).toBeNull()
  expect(chatOnly(await a.ls())).toBe("/kept/\t1 files, 1 b")
  expect(await human(room, { op: "rm", paths: ["kept"], recursive: true })).toBeNull()
  expect(await human(room, { op: "rm", paths: ["../x"] })).not.toBeNull()
  expect(chatOnly(await a.ls())).toBe("")
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

test("/me/soul.md is the agent's soul: read and edited with pi's tools, never moved or deleted, capped", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const first = await ada.read("/me/soul.md")
  expect(first).toBe("# ada\n\na sharp, helpful teammate.\n\n## what i've learned about working with them\n")
  const edited = await ada.run("edit", { path: "/me/soul.md", edits: [{ oldText: "working with them\n", newText: "working with them\n- no bullet points, they hate them\n" }] })
  expect(edited.ok).toBe(true)
  expect(await ada.read("me/soul.md")).toContain("- no bullet points, they hate them")
  expect((await ada.run("rm", { paths: ["/me/soul.md"] })).text).toContain("cannot be deleted")
  expect((await ada.run("mv", { from: "/me/soul.md", to: "/soul.md" })).text).toContain("stays where it is")
  expect((await ada.write("/me/other.md", "x")).text).toContain("only /me/soul.md")
  expect((await ada.write("/me/soul.md", "x".repeat(3_001))).text).toContain("tighten it")
  // kiko's first soul is the chief's.
  expect(await agent(room, "kiko").read("/me/soul.md")).toContain("i'm kiko, their chief")
})

test("/chat.md stays short: a write past the cap is refused", async () => {
  const a = agent(fresh())
  expect((await a.write("chat.md", "# trip\ngoal: lisbon")).ok).toBe(true)
  const long = await a.write("/chat.md", "x".repeat(3_001))
  expect(long.ok).toBe(false)
  expect(long.text).toContain("tighten it")
})

test("folders are real: mkdir -p, they survive their last file, an empty one goes like rmdir", async () => {
  const room = fresh()
  const a = agent(room)
  expect((await a.run("mkdir", { path: "/inbox/2026" })).text).toBe("made /inbox/2026")
  expect((await a.run("mkdir", { path: "inbox" })).text).toBe("inbox already exists")
  expect((await a.ls("/inbox")).split("\n")).toEqual(["/inbox/2026/\t0 files, 0 b"])
  await a.write("done/a.md", "a")
  await a.run("rm", { paths: ["done/a.md"] })
  expect(await a.ls("/done")).toBe("/done is empty")
  expect((await a.run("rm", { paths: ["done"] })).text).toBe("deleted 1 folder")
  expect((await a.run("read", { path: "done" })).ok).toBe(false)
  await a.write("full/x.md", "x")
  expect((await a.run("rm", { paths: ["full"] })).text).toContain("remove it with recursive")
  // A folder in the way of a file, and a file in the way of a folder.
  await a.write("doc.md", "d")
  expect((await a.run("mkdir", { path: "doc.md/sub" })).ok).toBe(false)
  expect((await a.write("inbox", "x")).text).toContain("is a folder")
  // The human makes an empty folder too, and agents see it.
  expect(await human(room, { op: "mkdir", path: "drafts/q3" })).toBeNull()
  expect(await a.ls("/drafts")).toBe("/drafts/q3/\t0 files, 0 b")
})

test("/home is the user's drive: one agent saves there in one chat, another reads it in a different chat", async () => {
  const ada = agent(fresh(), "ada")
  const kiko = agent(fresh(), "kiko")
  await fetch(`${origin}/notices/x/x`)
  expect((await ada.write("/home/cv.md", "# cv\nten years of cooking")).ok).toBe(true)
  expect(await kiko.read("/home/cv.md")).toBe("# cv\nten years of cooking")
  expect(await kiko.ls("/home")).toBe("/home/cv.md\t25 b\ttext/markdown")
  expect((await kiko.ls("/")).split("\n")).toContain("/home/\t1 files, 25 b")
  // Folders and edits work there too.
  expect((await kiko.run("mkdir", { path: "/home/letters" })).ok).toBe(true)
  expect((await kiko.run("edit", { path: "/home/cv.md", edits: [{ oldText: "ten", newText: "twelve" }] })).ok).toBe(true)
  // Moving across is a copy, not a move; cp works both ways.
  expect((await kiko.run("mv", { from: "/home/cv.md", to: "/cv.md" })).text).toContain("cp it")
  expect((await kiko.run("cp", { from: "/home/cv.md", to: "/cv.md" })).ok).toBe(true)
  expect(await kiko.read("/cv.md")).toBe("# cv\ntwelve years of cooking")
  expect((await kiko.run("rm", { paths: ["/home"] })).text).toContain("cannot be deleted")
  // Every change an agent makes to the drive is said in its chat.
  const notices = (await (await fetch(`${origin}/notices/x/x`)).json()) as string[]
  expect(notices).toEqual(["@ada saved /home/cv.md", "@kiko saved /home/cv.md"])
})

test("in a private chat the drive is read-only", async () => {
  await agent(fresh(), "ada").write("/home/shared.md", "hello")
  const quiet = agent(fresh(), "quiet")
  expect(await quiet.read("/home/shared.md")).toBe("hello")
  for (const out of [await quiet.write("/home/secret.md", "x"), await quiet.run("rm", { paths: ["/home/shared.md"] }), await quiet.run("mkdir", { path: "/home/x" })]) {
    expect(out.ok).toBe(false)
    expect(out.text).toContain("this chat is private")
  }
  // The chat's own files are untouched by the flag.
  expect((await quiet.write("/notes.md", "fine")).ok).toBe(true)
})
