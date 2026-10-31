export type Os = "macos" | "windows" | "linux"
export type Track = "terminal" | "browser" | "desktop" | "mixed"
export type Condition = "foreground" | "background"
export type Need = "display" | "chrome" | "electron" | "network" | "docker"

export interface Exec {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export interface Machine {
  readonly os: Os
  readonly id: string
  readonly workdir: string
  exec(cmd: readonly string[], opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<Exec>
  spawn(
    cmd: readonly string[],
    opts?: { cwd?: string; env?: Record<string, string> },
  ): Promise<{ pid: number; stop(): Promise<void> }>
  readText(path: string): Promise<string | undefined>
  writeText(path: string, text: string): Promise<void>
}

export interface Check {
  readonly name: string
  readonly pass: boolean
  readonly detail: string
}
export interface Verdict {
  readonly pass: boolean
  readonly checks: readonly Check[]
}

export interface Task {
  readonly id: string
  readonly track: Track
  readonly os: readonly Os[]
  readonly needs: readonly Need[]
  readonly heldOut: boolean
  readonly prompt: string
  readonly limits: { readonly turns: number; readonly seconds: number }
  setup(m: Machine, seed: number): Promise<void>
  oracle(m: Machine, seed: number): Promise<void>
  check(m: Machine, seed: number): Promise<Verdict>
}

export interface ToolSpec {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}
export interface Image {
  readonly mime: "image/png" | "image/jpeg"
  readonly base64: string
}
export interface ToolResult {
  readonly text: string
  readonly images: readonly Image[]
  readonly isError: boolean
}

export interface Contender {
  readonly name: string
  readonly version: string
  readonly tracks: readonly Track[]
  start(m: Machine, condition: Condition): Promise<void>
  tools(): readonly ToolSpec[]
  call(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult>
  stop(): Promise<void>
}

export interface ModelSpec {
  readonly id: string
  readonly vision: boolean
  readonly effort?: "low" | "medium" | "high"
}

export interface Background {
  readonly focusSteals: number
  readonly pointerMoves: number
  readonly keysSwallowed: number
  readonly windowsRaised: number
}
