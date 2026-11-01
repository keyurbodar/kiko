import { platform, type Platform } from "./capture"
import { toolValue, type Tools } from "./tools"

const TOOL_MS = 5_000
const OS_MS = 3_000
const OWNER_MS = 1_500

export type Command = { code: number; out: string }

export type Spawned = { exited: Promise<number> }

export type ClipboardDeps = {
  platform?: Platform
  tools?: () => Tools | null
  run?: (cmd: string[], stdin?: string) => Promise<Command>
  spawn?: (cmd: string[], stdin: string) => Spawned
}

export type Clipboard = {
  read(): Promise<string | null>
  write(text: string): Promise<boolean>
}

const OS_READ: Readonly<Record<"macos" | "linux", readonly (readonly string[])[]>> = {
  macos: [["pbpaste"]],
  linux: [
    ["wl-paste", "--no-newline"],
    ["xclip", "-selection", "clipboard", "-o"],
  ],
}

const OS_WRITE: Readonly<Record<"macos" | "linux", readonly (readonly string[])[]>> = {
  macos: [["pbcopy"]],
  linux: [["wl-copy"], ["xclip", "-selection", "clipboard", "-i"]],
}

function system(command: readonly string[], stdin?: string): Promise<Command> {
  return new Promise((resolve) => {
    try {
      const child = Bun.spawn([...command], {
        stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
        stdout: "pipe",
        stderr: "ignore",
        signal: AbortSignal.timeout(OS_MS),
      })
      void new Response(child.stdout)
        .text()
        .then((out) => child.exited.then((code) => resolve({ code, out })))
        .catch(() => resolve({ code: -1, out: "" }))
    } catch {
      resolve({ code: -1, out: "" })
    }
  })
}

function withTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), TOOL_MS)
    const settle = (value: T) => {
      clearTimeout(timer)
      resolve(value)
    }
    work.then(settle, () => settle(fallback))
  })
}

function launch(command: readonly string[], stdin: string): Spawned {
  return Bun.spawn([...command], {
    stdin: new TextEncoder().encode(stdin),
    stdout: "ignore",
    stderr: "ignore",
  })
}

function keep(spawn: (cmd: string[], stdin: string) => Spawned, command: readonly string[], text: string) {
  return new Promise<boolean>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(ok)
    }
    try {
      const child = spawn([...command], text)
      timer = setTimeout(() => finish(true), OWNER_MS)
      void child.exited.then((code) => finish(code === 0)).catch(() => finish(false))
    } catch {
      finish(false)
    }
  })
}

export function createClipboard(deps: ClipboardDeps = {}): Clipboard {
  const run = deps.run ?? system
  const spawn = deps.spawn ?? launch
  const name = deps.platform ?? platform()
  const tools = () => deps.tools?.() ?? null

  const readTool = async (): Promise<string | null> => {
    const tool = tools()
    if (!tool?.has("clipboard_read")) return null
    const value = await tool.call("clipboard_read", { include_text: true })
    const result = toolValue(value)
    const text = result?.text
    return typeof text === "string" ? text : null
  }

  const writeTool = async (text: string): Promise<boolean> => {
    const tool = tools()
    if (!tool?.has("clipboard_write")) return false
    await tool.call("clipboard_write", { text })
    return true
  }

  const readOs = async (): Promise<string | null> => {
    if (name === "windows") return null
    for (const command of OS_READ[name]) {
      const result = await run([...command])
      if (result.code === 0) return result.out
    }
    return null
  }

  const writeOs = async (text: string): Promise<boolean> => {
    if (name === "windows") return false
    for (const command of OS_WRITE[name]) {
      if (name === "linux") {
        if (await keep(spawn, command, text)) return true
        continue
      }
      const result = await run([...command], text)
      if (result.code === 0) return true
    }
    return false
  }

  return {
    async read() {
      const viaTool = await withTimeout(readTool(), null)
      if (viaTool !== null) return viaTool
      return readOs()
    },
    async write(text) {
      if (await withTimeout(writeTool(text), false)) return true
      return writeOs(text)
    },
  }
}
