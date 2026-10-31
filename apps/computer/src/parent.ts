import type { Readable } from "node:stream"

const PARENT_PIPE = "KIKO_PARENT_PIPE"

export function parentPipeAsked(env: Record<string, string | undefined>): boolean {
  return env[PARENT_PIPE] === "1"
}

export function exitWhenParentDies(stream: Readable, exit: () => void): void {
  let done = false
  const stop = () => {
    if (done) return
    done = true
    exit()
  }
  stream.on("end", stop)
  stream.on("close", stop)
  stream.on("error", stop)
  stream.resume()
}
