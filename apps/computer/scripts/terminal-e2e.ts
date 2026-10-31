import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TerminalManager } from "../src/terminal/manager"

const manager = new TerminalManager()

function ok(condition: boolean, what: string): void {
  if (!condition) {
    console.error(`FAIL ${what}`)
    manager.closeAll()
    process.exit(1)
  }
  console.log(`ok ${what}`)
}

const python = Bun.which(process.platform === "win32" ? "python" : "python3") ?? Bun.which("python")
const vim = Bun.which("vim") ?? Bun.which("nvim") ?? Bun.which("vi")
const dir = await mkdtemp(join(tmpdir(), "kiko-terminal-e2e-"))

async function prompt(id: string): Promise<void> {
  const ready = await manager.wait({ id, until: "[>#$%]\\s*$", regex: true, timeoutMs: 60_000 })
  ok(ready.matched, `${id} showed a prompt: ${JSON.stringify(ready.text.slice(-80))}`)
}

try {
  console.log(`platform ${process.platform} bun ${Bun.version} pty ${typeof Bun.Terminal === "function"}`)
  ok(typeof Bun.Terminal === "function", "Bun has a pseudo-terminal")
  ok(python !== null, `found a python: ${python ?? "none"}`)

  const repl = manager.open({ name: "repl", cols: 100, rows: 30 })
  await prompt(repl.id)

  if (process.platform === "win32") {
    manager.send({ id: repl.id, text: `& "${python}" -c "print('py-separate')"` })
    manager.send({ id: repl.id, keys: ["enter"] })
    const separate = await manager.wait({ id: repl.id, until: "py-separate", timeoutMs: 15_000 })
    console.log(`probe separate writes ${separate.matched}`)
    manager.send({ id: repl.id, text: `& "${python}" -c "print('py-combined')"`, keys: ["enter"] })
    const combined = await manager.wait({ id: repl.id, until: "py-combined", timeoutMs: 15_000 })
    console.log(`probe combined write ${combined.matched} tail ${JSON.stringify(combined.text.slice(-300))}`)
  }

  const launch = process.platform === "win32" ? `& "${python}" -q` : `"${python}" -q`
  manager.send({ id: repl.id, text: launch, keys: ["enter"] })
  const pythonPrompt = await manager.wait({ id: repl.id, until: ">>>", timeoutMs: 60_000 })
  ok(pythonPrompt.matched, `the python prompt appeared: ${JSON.stringify(pythonPrompt.text.slice(-400))}`)

  manager.send({ id: repl.id, text: "print(6*7)", keys: ["enter"] })
  const answer = await manager.wait({ id: repl.id, until: "42", timeoutMs: 30_000 })
  ok(answer.matched, "the REPL printed 42")

  const screen = await manager.read({ id: repl.id, mode: "screen" })
  ok(screen.text.includes("42"), `the screen shows 42: ${JSON.stringify(screen.text)}`)

  if (process.platform === "win32") {
    console.log("skip ctrl+c: ConPTY does not turn an input byte into a console interrupt")
  } else {
    manager.send({ id: repl.id, text: "import time; time.sleep(30)", keys: ["enter"] })
    await manager.wait({ id: repl.id, until: "time.sleep(30)", timeoutMs: 10_000 })
    manager.send({ id: repl.id, keys: ["ctrl+c"] })
    const interrupt = await manager.wait({ id: repl.id, until: "KeyboardInterrupt", timeoutMs: 15_000 })
    ok(interrupt.matched, "ctrl+c interrupted the REPL")
  }

  manager.send({ id: repl.id, text: "exit()", keys: ["enter"] })

  const note = join(dir, "note.txt")
  await writeFile(note, "kiko terminal screen\nsecond line\n")
  const editor = manager.open({ name: "editor", cols: 100, rows: 30 })
  await prompt(editor.id)
  const command = vim ? `"${vim}" -u NONE -N "${note}"` : `"${python}" -u "${join(dir, "fullscreen.py")}"`
  if (!vim)
    await writeFile(
      join(dir, "fullscreen.py"),
      'import sys\nsys.stdout.write("\\x1b[?1049h\\x1b[2J\\x1b[Hkiko terminal screen\\nsecond line\\n")\nsys.stdout.flush()\ninput()\n',
    )
  manager.send({ id: editor.id, text: command, keys: ["enter"] })
  const drawn = await manager.wait({ id: editor.id, until: "kiko terminal screen", timeoutMs: 60_000 })
  ok(drawn.matched, `the full-screen app drew its text: ${JSON.stringify(drawn.text.slice(-200))}`)

  const view = await manager.read({ id: editor.id, mode: "screen" })
  ok(view.text.includes("kiko terminal screen"), `the screen has the first line: ${JSON.stringify(view.text)}`)
  ok(view.text.includes("second line"), `the screen has the second line: ${JSON.stringify(view.text)}`)

  if (vim) {
    manager.send({ id: editor.id, keys: ["esc"] })
    manager.send({ id: editor.id, text: ":q!", keys: ["enter"] })
  }
  ok(manager.list().terminals.length === 2, "both terminals are listed")

  await manager.close({ id: editor.id })
  await manager.close({ id: repl.id })
  ok(manager.list().terminals.length === 0, "closing both leaves none")

  console.log(`PASS terminal e2e on ${process.platform}`)
} finally {
  manager.closeAll()
  await rm(dir, { recursive: true, force: true })
}
