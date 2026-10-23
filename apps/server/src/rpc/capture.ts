export type Captured = { readonly frames: readonly { readonly t: string }[]; readonly closed: string | null }

export async function capture(view: WebSocket, run: (ws: WebSocket) => Promise<void>): Promise<Captured> {
  const frames: { t: string }[] = []
  let closed: string | null = null
  const ws = new Proxy(view, {
    get(target, property) {
      if (property === "send") return (raw: string) => frames.push(JSON.parse(raw) as { t: string })
      if (property === "close")
        return (_code?: number, reason?: string) => {
          closed = reason ?? "closed"
        }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  await run(ws)
  return { frames, closed }
}

export const replyOf = <T extends string>(captured: Captured, t: T) =>
  captured.frames.find((frame): frame is { t: T } & Record<string, unknown> => frame.t === t)
