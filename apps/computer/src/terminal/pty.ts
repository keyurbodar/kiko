import { homedir } from "node:os"

export type PtyInput = {
  command: readonly string[]
  cwd: string
  cols: number
  rows: number
  onData(chunk: Uint8Array): void
  onExit(code: number | null): void
}

export type Pty = {
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  close(): void
  readonly exited: Promise<number | null>
}

export type PtySpawn = (input: PtyInput) => Pty

export function hasPty(): boolean {
  return typeof Bun.Terminal === "function"
}

export function defaultShell(platform = process.platform): string[] {
  if (platform === "win32") return ["powershell.exe", "-NoLogo", "-NoProfile"]
  return [process.env.SHELL ?? (platform === "darwin" ? "/bin/zsh" : "/bin/bash")]
}

export function defaultCwd(): string {
  return homedir()
}

function terminalEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env.TERM = "xterm-256color"
  env.COLORTERM = "truecolor"
  return env
}

export const bunPty: PtySpawn = (input) => {
  let terminal: Bun.Terminal | undefined
  const process_ = Bun.spawn([...input.command], {
    cwd: input.cwd,
    env: terminalEnv(),
    terminal: {
      cols: input.cols,
      rows: input.rows,
      name: "xterm-256color",
      data: (created, data) => {
        terminal ??= created
        input.onData(data)
      },
    },
  })
  terminal ??= process_.terminal
  const exited = process_.exited.then((code) => {
    input.onExit(code)
    return code
  })
  return {
    pid: process_.pid,
    write: (data) => {
      if (!terminal) throw new Error("the terminal is not ready yet")
      terminal.write(data)
    },
    resize: (cols, rows) => {
      try {
        terminal?.resize(cols, rows)
      } catch {}
    },
    kill: () => {
      try {
        process_.kill()
      } catch {}
    },
    close: () => {
      try {
        terminal?.close()
      } catch {}
    },
    exited,
  }
}
