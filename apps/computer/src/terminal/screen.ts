import { Terminal } from "@xterm/headless"

export type Screen = {
  write(text: string, done?: () => void): void
  text(): string
  resize(cols: number, rows: number): void
  dispose(): void
}

export function createScreen(cols: number, rows: number, onReply: (data: string) => void): Screen {
  const terminal = new Terminal({ cols, rows, scrollback: 1_000, allowProposedApi: true })
  const reply = terminal.onData((data) => onReply(data))
  let disposed = false
  return {
    write: (text, done) => {
      if (disposed || text.length === 0) {
        done?.()
        return
      }
      terminal.write(text, () => done?.())
    },
    text: () => {
      if (disposed) return ""
      const buffer = terminal.buffer.active
      const lines: string[] = []
      for (let index = 0; index < terminal.rows; index += 1) {
        lines.push(buffer.getLine(buffer.viewportY + index)?.translateToString(true) ?? "")
      }
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
      while (lines.length > 0 && lines[0] === "") lines.shift()
      return lines.join("\n")
    },
    resize: (nextCols, nextRows) => {
      if (disposed) return
      terminal.resize(nextCols, nextRows)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      reply.dispose()
      terminal.dispose()
    },
  }
}
