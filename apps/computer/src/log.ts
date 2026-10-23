import { appendFile } from "node:fs/promises"
import type { FailCode } from "@kiko/computer/wire"

export class Fail extends Error {
  readonly code: FailCode

  constructor(code: FailCode, message: string) {
    super(message)
    this.code = code
  }
}

export function failureCode(error: unknown): FailCode {
  return error instanceof Fail ? error.code : "failed"
}

export function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type Logger = {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

const stamp = () => new Date().toISOString()

export function createLogger(name: string, file?: string): Logger {
  const write = (level: string, message: string) => {
    const line = `${stamp()} ${level} ${name}: ${message}`
    console.error(line)
    if (file) appendFile(file, `${line}\n`).catch(() => undefined)
  }
  return {
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
  }
}
