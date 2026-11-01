import type { Task } from "../../types"
import {
  check,
  LIMITS,
  mulberry32,
  pick,
  python,
  readJson,
  readText,
  run,
  verdict,
  writeJson,
  writeText,
} from "../helpers"

const OPTIONS = ["Export as CSV", "Export as JSON", "Export as PDF", "Export as HTML", "Print preview", "Cancel"]

const MENU = `import curses
import json

options = json.load(open("options.json"))["options"]


def main(screen):
    curses.curs_set(0)
    screen.keypad(True)
    index = 0
    ready = False
    while True:
        screen.erase()
        screen.addstr(0, 0, "Choose an export format")
        for position, option in enumerate(options):
            attribute = curses.A_REVERSE if position == index else curses.A_NORMAL
            screen.addstr(2 + position, 2, option, attribute)
        screen.refresh()
        if not ready:
            with open("menu-ready.txt", "w", encoding="utf-8") as handle:
                handle.write("ready\\n")
            ready = True
        key = screen.getch()
        if key == curses.KEY_DOWN:
            index = min(index + 1, len(options) - 1)
        elif key == curses.KEY_UP:
            index = max(index - 1, 0)
        elif key in (10, 13, curses.KEY_ENTER):
            with open("choice.txt", "w", encoding="utf-8") as handle:
                handle.write(options[index] + "\\n")
            return


curses.wrapper(main)
`

const DRIVER = `import json
import os
import pty
import select
import sys
import time

options = json.load(open("options.json"))["options"]
target = json.load(open("request.json"))["target"]
index = options.index(target)


def drain(fd, output):
    while select.select([fd], [], [], 0)[0]:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            return
        if not chunk:
            return
        output.append(chunk)


pid, fd = pty.fork()
if pid == 0:
    os.environ["TERM"] = "xterm-256color"
    os.execv(sys.executable, [sys.executable, "menu.py"])
os.set_blocking(fd, False)
output = []
deadline = time.time() + 20
while time.time() < deadline and not os.path.exists("menu-ready.txt"):
    drain(fd, output)
    time.sleep(0.05)
if not os.path.exists("menu-ready.txt"):
    _, status = os.waitpid(pid, os.WNOHANG)
    sys.stderr.write(f"menu.py never became ready, child status {status}\n")
    sys.stderr.write(b"".join(output).decode("utf-8", "replace"))
    os.kill(pid, 9)
    sys.exit(1)
for _ in range(index):
    os.write(fd, b"\\x1bOB")
    time.sleep(0.2)
    drain(fd, output)
os.write(fd, b"\\n")
deadline = time.time() + 10
while time.time() < deadline:
    if os.path.exists("choice.txt"):
        os.waitpid(pid, 0)
        sys.exit(0)
    drain(fd, output)
    time.sleep(0.05)
sys.stderr.write(b"".join(output).decode("utf-8", "replace"))
os.kill(pid, 9)
sys.exit(1)
`

export const tuiMenu: Task = {
  id: "terminal-109-tui-menu",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "edge",
  prompt: "Run menu.py in a terminal and pick the option named in request.json. It writes your choice to choice.txt.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const target = pick(mulberry32(seed), OPTIONS)
    await writeJson(m, "options.json", { options: OPTIONS })
    await writeJson(m, "request.json", { target })
    await writeText(m, "menu.py", MENU)
  },
  oracle: async (m) => {
    await writeText(m, "drive.py", DRIVER)
    const driven = await run(m, [python(m), "drive.py"], { timeoutMs: 60_000 })
    await run(m, [python(m), "-c", 'import os; os.remove("drive.py")'])
    if (driven.code !== 0) throw new Error(`could not drive the menu: ${driven.stderr || driven.stdout}`)
  },
  check: async (m, seed) => {
    const target = pick(mulberry32(seed), OPTIONS)
    const choice = await readText(m, "choice.txt")
    const request = await readJson<{ target?: string }>(m, "request.json")
    return verdict([
      check("choice matches", choice?.trim() === target, `choice.txt was ${JSON.stringify(choice)}`),
      check("request untouched", request?.target === target, "request.json changed"),
    ])
  },
}
