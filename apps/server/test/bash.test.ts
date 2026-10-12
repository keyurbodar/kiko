import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

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
const fresh = () => `01JZ8Q4T7B${String(++n).padStart(16, "0")}`
type Out = { ok: boolean; text: string; ms: number; touched?: string[] }

function agent(room: string, slug = "ada") {
  const run = async (name: string, args: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Out> => {
    const res = await fetch(`${origin}/tool/${room}/${slug}`, { method: "POST", headers, body: JSON.stringify({ name, args }) })
    return (await res.json()) as Out
  }
  return {
    run,
    bash: (command: string) => run("bash", { command }),
    write: (path: string, content: string) => run("write", { path, content }),
    read: async (path: string) => (await run("read", { path })).text,
    ls: async (path = "/") => (await run("ls", { path })).text,
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const idle = (room: string, slug: string) => fetch(`${origin}/idle/${room}/${slug}`)

test("pipes, redirects, and in-place edits work on the chat's real files", async () => {
  const a = agent(fresh())
  await a.write("notes/a.md", "todo: book flights\ndone: pack\n")
  await a.write("notes/b.md", "todo: call mom\n")
  await a.write("data.json", '{"trips":[{"city":"rome","days":3},{"city":"oslo","days":2}]}')

  const grep = await a.bash("grep -rh todo /notes | sort | wc -l")
  expect(grep).toMatchObject({ ok: true, text: "2\n" })
  expect((await a.bash("jq '[.trips[].days] | add' /data.json")).text).toBe("5\n")
  const named = await a.bash("printf 'b\\na\\na\\n' > /tmp/x; sort /tmp/x | uniq | cut -c1 | tr a-z A-Z | head -2 | tail -1; find /notes -type f | xargs cat | wc -l; diff /notes/a.md /notes/a.md && echo same")
  expect(named).toMatchObject({ ok: true, text: "B\n3\nsame\n" })

  expect((await a.bash("grep -rh todo /notes > /todos.txt && sed -i 's/todo: //' /todos.txt")).ok).toBe(true)
  expect(await a.read("todos.txt")).toBe("book flights\ncall mom\n")
  expect(await a.ls()).toContain("/todos.txt")
})

test("a failing command reports its error and exit code", async () => {
  const a = agent(fresh())
  const out = await a.bash("cat /missing.txt")
  expect(out.ok).toBe(false)
  expect(out.text).toContain("No such file")
  expect(out.text).toContain("exited with code 1")
})

test("a command that touches nothing leaves the files as they were", async () => {
  const a = agent(fresh())
  await a.write("keep.md", "x")
  const before = await a.ls()
  expect((await a.bash("true; echo $HOME; pwd")).text).toBe("/\n/\n")
  expect(await a.ls()).toBe(before)
})

test("a teammate's write between a command's read and its write is never lost", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const bo = agent(room, "bo")
  await ada.write("count.txt", "1\n")
  await idle(room, "ada")
  const slow = ada.bash("v=$(cat /count.txt); sleep 1; echo $((v + 10)) > /count.txt")
  await bo.read("count.txt")
  await sleep(300)
  expect((await bo.write("count.txt", "2\n")).ok).toBe(true)
  const out = await slow
  expect(out.ok).toBe(false)
  expect(out.text).toContain("@bo is working on /count.txt")
  expect(await ada.read("count.txt")).toBe("2\n")
})

test("a write after the holder finished, over a file the command read before, is refused by its hash", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const bo = agent(room, "bo")
  await ada.write("count.txt", "1\n")
  await idle(room, "ada")
  const slow = ada.bash("v=$(cat /count.txt); sleep 1; echo $((v + 10)) > /count.txt")
  await bo.read("count.txt")
  await sleep(300)
  expect((await bo.write("count.txt", "2\n")).ok).toBe(true)
  await idle(room, "bo")
  const out = await slow
  expect(out.ok).toBe(false)
  expect(out.text).toContain("/count.txt changed after this command started")
  expect(await ada.read("count.txt")).toBe("2\n")
})

test("one agent's parallel commands each check their own view, so neither overwrites the other", async () => {
  const a = agent(fresh())
  await a.write("n.txt", "0\n")
  const bump = () => a.bash("v=$(cat /n.txt); sleep 0.5; echo $((v + 1)) > /n.txt")
  const [x, y] = await Promise.all([bump(), bump()])
  expect([x.ok, y.ok].sort()).toEqual([false, true])
  expect(await a.read("n.txt")).toBe("1\n")
})

test("a command reads one snapshot: a write made while it runs does not show up halfway", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const bo = agent(room, "bo")
  await ada.write("s.txt", "old\n")
  await idle(room, "ada")
  const slow = ada.bash("cat /s.txt; sleep 1; cat /s.txt")
  await bo.read("s.txt")
  await sleep(300)
  await bo.write("s.txt", "new\n")
  expect((await slow).text).toBe("old\nold\n")
  expect((await ada.bash("cat /s.txt")).text).toBe("new\n")
})

test("commands on different files run at the same time, from one agent or several", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const bo = agent(room, "bo")
  const started = performance.now()
  const outs = await Promise.all([
    ada.bash("sleep 1; echo one > /one.txt"),
    ada.bash("sleep 1; echo two > /two.txt"),
    bo.bash("sleep 1; echo three > /three.txt"),
  ])
  expect(outs.every((o) => o.ok)).toBe(true)
  expect(performance.now() - started).toBeLessThan(2500)
  expect((await bo.bash("cat /one.txt /two.txt /three.txt")).text).toBe("one\ntwo\nthree\n")
})

test("two agents creating the same new file: the first wins and the second is told", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const bo = agent(room, "bo")
  const [x, y] = await Promise.all([ada.bash("sleep 0.3; echo ada > /report.md"), bo.bash("sleep 0.3; echo bo > /report.md")])
  expect([x.ok, y.ok].sort()).toEqual([false, true])
  expect(await ada.read("report.md")).toBe(x.ok ? "ada\n" : "bo\n")
  expect((x.ok ? y : x).text).toMatch(/is working on \/report\.md|report\.md changed after this command started/)
})

test("handing work over through files: one agent's output is the next one's input", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const bo = agent(room, "bo")
  expect((await ada.bash("mkdir -p /handoff && printf 'rome,3\\noslo,2\\nlima,4\\n' > /handoff/trips.csv")).ok).toBe(true)
  const held = await bo.bash("cat /handoff/trips.csv | wc -l; echo late >> /handoff/trips.csv")
  expect(held.ok).toBe(false)
  expect(held.text).toContain("3\n")
  expect(held.text).toContain("@ada is working on")
  await idle(room, "ada")
  const out = await bo.bash("sort -t, -k2 -n /handoff/trips.csv | awk -F, '{print $1}' | tee /handoff/order.txt")
  expect(out.text).toBe("oslo\nrome\nlima\n")
  expect(await ada.read("handoff/order.txt")).toBe("oslo\nrome\nlima\n")
})

test("the write-to-temp-then-mv pattern replaces the file conditionally and leaves no temp file", async () => {
  const room = fresh()
  const a = agent(room)
  await a.write("list.txt", "b\na\n")
  expect((await a.bash("sort /list.txt > /list.tmp && mv /list.tmp /list.txt")).ok).toBe(true)
  expect(await a.read("list.txt")).toBe("a\nb\n")
  expect(await a.ls()).not.toContain("list.tmp")
})

test("the chat's rules still hold: /chat.md stays short and a private chat's drive is read-only", async () => {
  const room = fresh()
  const a = agent(room)
  const long = await a.bash("seq 1 2000 > /chat.md")
  expect(long.ok).toBe(false)
  expect(long.text).toContain("/chat.md would be")
  const quiet = await agent(room, "quiet").bash("echo hi > /home/x.txt")
  expect(quiet.ok).toBe(false)
  expect(quiet.text).toContain("private")
  expect((await a.bash("echo hi > /home/bash-note.txt && cat /home/bash-note.txt")).text).toBe("hi\n")
})

test("a recursive walk reads every file once", async () => {
  const room = fresh()
  const a = agent(room)
  await Promise.all(Array.from({ length: 24 }, (_, i) => a.write(`many/f${String(i).padStart(2, "0")}.txt`, i % 3 ? "x\n" : "hit\n")))
  await fetch(`${origin}/counts/${room}/ada`)
  const out = await a.bash("grep -rl hit /many | wc -l")
  expect(out.text).toBe("8\n")
  const counts = (await (await fetch(`${origin}/counts/${room}/ada`)).json()) as { stat: number }
  expect(counts.stat).toBe(0)
})

test("teammates never see half a command: its changes land together when it ends", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const bo = agent(room, "bo")
  const slow = ada.bash("echo part one > /draft.md; sleep 1; echo part two >> /draft.md")
  await sleep(400)
  expect(await bo.ls()).not.toContain("draft.md")
  expect((await slow).ok).toBe(true)
  expect(await bo.read("draft.md")).toBe("part one\npart two\n")
})

test("/tmp is the command's own scratch space and is never saved", async () => {
  const a = agent(fresh())
  const out = await a.bash("echo b > /tmp/x; echo a >> /tmp/x; sort /tmp/x > /sorted.txt; f=$(mktemp); echo hi > $f; cat $f")
  expect(out).toMatchObject({ ok: true, text: "hi\n" })
  expect(await a.read("sorted.txt")).toBe("a\nb\n")
  expect(await a.ls()).not.toContain("tmp")
  expect((await a.bash("ls /tmp | wc -l")).text).toBe("0\n")
})

test("a command that runs out of time saves nothing", async () => {
  const room = fresh()
  const a = agent(room)
  const res = await fetch(`${origin}/tool/${room}/ada`, { method: "POST", body: JSON.stringify({ name: "bash", args: { command: "echo x > /late.txt; sleep 3", timeout: 1 } }) })
  const out = (await res.json()) as Out
  expect(out.ok).toBe(false)
  expect(out.text).toContain("timed out")
  expect(await a.ls()).not.toContain("late.txt")
})

test("mv moves the stored file instead of copying it, folders included", async () => {
  const room = fresh()
  const a = agent(room)
  await a.write("in/a.md", "a")
  await a.write("in/b.md", "b")
  const before = (await (await fetch(`${origin}/keys/${room}`)).json()) as string[]
  expect((await a.bash("mv /in /out && mv /out/a.md /out/first.md")).ok).toBe(true)
  const after = (await (await fetch(`${origin}/keys/${room}`)).json()) as string[]
  expect(after.sort()).toEqual(before.sort())
  expect((await a.bash("find / -path '/out/*' -type f | sort; test -e /in && echo in || echo gone")).text).toBe("/out/b.md\n/out/first.md\ngone\n")
})

test("rm keeps a file a teammate changed after the command started", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const bo = agent(room, "bo")
  await ada.write("old/notes.md", "v1")
  await ada.write("old/keep.md", "v1")
  await idle(room, "ada")
  const slow = ada.bash("sleep 1; rm -r /old")
  await bo.read("old/notes.md")
  await sleep(300)
  await bo.write("old/notes.md", "v2")
  await idle(room, "bo")
  const out = await slow
  expect(out.ok).toBe(false)
  expect(out.text).toContain("/old changed after this command started")
  expect(await ada.read("old/notes.md")).toBe("v2")
  expect(await ada.read("old/keep.md")).toBe("v1")
})

test("many files written in a loop are saved in one commit", async () => {
  const a = agent(fresh())
  const out = await a.bash("mkdir -p /n; for i in $(seq 1 30); do echo $i > /n/$i.txt; done; ls /n | wc -l")
  expect(out.text).toBe("30\n")
  expect((await a.bash("cat /n/*.txt | awk '{s += $1} END {print s}'")).text).toBe("465\n")
})

test("a command's writes save before its deletes: a refused delete keeps its file and says what saved", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const bo = agent(room, "bo")
  await ada.write("b.txt", "1\n")
  await idle(room, "ada")
  const slow = ada.bash("echo new > /a.txt; mkdir /made; mv /b.txt /moved.txt 2>/dev/null; v=$(cat /moved.txt); sleep 1; echo $v-ada > /moved.txt")
  await bo.read("b.txt")
  await sleep(300)
  await bo.write("b.txt", "2\n")
  await idle(room, "bo")
  const out = await slow
  expect(out.ok).toBe(false)
  expect(out.text).toContain("/b.txt changed after this command started")
  expect(out.text).toContain("the file was kept")
  expect(out.text).toContain("saved in the chat's files")
  expect(await ada.ls()).toContain("/a.txt")
  expect(await ada.ls()).toContain("/made")
  expect(await ada.ls()).toContain("/moved.txt")
  expect(await ada.read("b.txt")).toBe("2\n")
})

test("changes to the chat's files and the drive in one command both save", async () => {
  const a = agent(fresh())
  expect((await a.bash("echo chat > /c.txt; echo drive > /home/both.txt")).ok).toBe(true)
  expect((await a.bash("cat /c.txt /home/both.txt")).text).toBe("chat\ndrive\n")
})

test("when the drive refuses a command's write, the output says the chat's files did save", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const bo = agent(room, "bo")
  await ada.bash("echo one > /home/d.txt")
  await idle(room, "ada")
  const slow = ada.bash("echo new > /a.txt; v=$(cat /home/d.txt); sleep 1; echo $v-ada > /home/d.txt")
  await sleep(300)
  await bo.bash("echo two > /home/d.txt")
  await idle(room, "bo")
  const out = await slow
  expect(out.ok).toBe(false)
  expect(out.text).toContain("/home/d.txt changed after this command started")
  expect(out.text).toContain("nothing this command changed in the drive (/home) was saved")
  expect(out.text).toContain("saved in the chat's files")
  expect(await ada.read("/a.txt")).toBe("new\n")
  expect(await ada.read("/home/d.txt")).toBe("two\n")
  expect(out.touched).toEqual(["/a.txt"])
})

test("a command stopped while it saves still says what it saved, and records it", async () => {
  const a = agent(fresh())
  const out = await a.run("bash", { command: "echo x > /a.txt && echo y > /b.txt" }, { "x-test-stop-on-commit": "1" })
  expect(out.ok).toBe(true)
  expect(out.text).toContain("stopped while it saved")
  expect(out.text).toContain("/a.txt")
  expect(out.text).toContain("/b.txt")
  expect(out.touched?.sort()).toEqual(["/a.txt", "/b.txt"])
  expect(await a.read("/a.txt")).toBe("x\n")
  expect(await a.read("/b.txt")).toBe("y\n")
})

test("a move into the drive keeps its source when the drive refuses the write", async () => {
  const room = fresh()
  const ada = agent(room, "ada")
  const bo = agent(room, "bo")
  await ada.bash("echo keep > /c.txt")
  await idle(room, "ada")
  const slow = ada.bash("mv /c.txt /home/m.txt; sleep 1")
  await sleep(300)
  await bo.bash("echo bo > /home/m.txt")
  await idle(room, "bo")
  const out = await slow
  expect(await ada.read("/c.txt")).toBe("keep\n")
  expect(await ada.read("/home/m.txt")).toBe("bo\n")
  expect(out.ok).toBe(false)
  expect(out.text).toContain("/home/m.txt changed after this command started")
  expect(out.text).toContain("/c.txt: not saved")
  expect(out.touched ?? []).toEqual([])
})

test("a runaway loop stops at the interpreter's limits and saves nothing", async () => {
  const a = agent(fresh())
  const out = await a.bash("echo partial > /p.txt; while true; do :; done")
  expect(out.ok).toBe(false)
  expect(out.text).toContain("too many commands")
  expect(out.text).toContain("none of its changes were saved")
  expect(out.ms).toBeLessThan(10_000)
  expect(await a.ls()).not.toContain("p.txt")
})

test("one command reads a bounded number of files, and says how to narrow it", async () => {
  const a = agent(fresh())
  expect((await a.bash("mkdir /big; for i in $(seq 1 450); do echo $i > /big/$i.txt; done")).ok).toBe(true)
  const out = await a.bash("cat /big/*.txt > /dev/null")
  expect(out.ok).toBe(false)
  expect(out.text).toContain("read more than 400 files and was stopped")
  expect(out.text).not.toContain("No such file")
  expect((await a.bash("cat /big/1*.txt | wc -l")).text).toBe("111\n")
}, 30_000)
