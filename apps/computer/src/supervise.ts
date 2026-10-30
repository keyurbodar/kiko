const FIRST_DELAY_MS = 1_000
const MAX_DELAY_MS = 30_000
const FAST_EXIT_MS = 10_000

export function nextDelay(previousDelayMs: number, livedMs: number): number {
  if (livedMs >= FAST_EXIT_MS) return FIRST_DELAY_MS
  if (previousDelayMs <= 0) return FIRST_DELAY_MS
  return Math.min(MAX_DELAY_MS, previousDelayMs * 2)
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    let timer: ReturnType<typeof setTimeout>
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })
}

export async function supervise(daemon: string): Promise<number> {
  const stop = new AbortController()
  let child: Bun.Subprocess | null = null
  const forward = (signal: NodeJS.Signals) => {
    stop.abort()
    child?.kill(signal)
  }
  const onTerm = () => forward("SIGTERM")
  const onInt = () => forward("SIGINT")
  process.on("SIGTERM", onTerm)
  process.on("SIGINT", onInt)
  let delay = 0
  try {
    while (!stop.signal.aborted) {
      const started = Date.now()
      let code: number | null = null
      try {
        child = Bun.spawn([daemon, "run"], { stdio: ["inherit", "inherit", "inherit"] })
        code = await child.exited
      } catch {
        code = null
      }
      child = null
      const lived = Date.now() - started
      if (stop.signal.aborted) break
      delay = nextDelay(delay, lived)
      console.error(`kiko-computer: the daemon exited with ${code ?? "an error"}; restarting in ${delay / 1000}s`)
      await wait(delay, stop.signal)
    }
  } finally {
    process.off("SIGTERM", onTerm)
    process.off("SIGINT", onInt)
  }
  return 0
}
