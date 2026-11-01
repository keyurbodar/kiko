import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import type { Machine } from "../src/types"

const BENCH_ROOT = join(import.meta.dir, "..")
const BROWSER_PAGE = join(BENCH_ROOT, "fixtures", "browser", "typing.html")

export interface Fixture {
  readonly app: string
  readonly title: string
  readonly decoyTitle: string
  readonly entryName: string
  readonly browserUrl: string
  readonly browserTitle: string
  stop(): Promise<void>
}

type Process = { pid: number; stop(): Promise<void> }

async function linuxFixture(
  m: Machine,
): Promise<{ app: string; title: string; decoyTitle: string; processes: Process[] }> {
  const script = join(BENCH_ROOT, "fixtures", "desktop", "gtk_window.py")
  const env = { env: { GDK_BACKEND: "x11" } }
  const fixture = await m.spawn(["python3", script, "kiko-bench-fixture", "seed"], env)
  const decoy = await m.spawn(["python3", script, "kiko-bench-decoy", ""], env)
  return { app: "", title: "kiko-bench-fixture", decoyTitle: "kiko-bench-decoy", processes: [fixture, decoy] }
}

async function macFixture(
  m: Machine,
): Promise<{ app: string; title: string; decoyTitle: string; processes: Process[] }> {
  const path = join(m.workdir, "fixture.txt")
  await m.writeText(path, "seed")
  await m.exec(["open", "-g", "-a", "TextEdit", path])
  await m.exec(["open", "-g", "-a", "Finder", m.workdir])
  return { app: "TextEdit", title: basename(path), decoyTitle: "Finder", processes: [] }
}

export async function prepareFixture(m: Machine): Promise<Fixture> {
  const platform = m.os === "macos" ? await macFixture(m) : await linuxFixture(m)
  return {
    app: platform.app,
    title: platform.title,
    decoyTitle: platform.decoyTitle,
    entryName: m.os === "linux" ? "kiko-bench-entry" : "",
    browserUrl: pathToFileURL(BROWSER_PAGE).href,
    browserTitle: "kiko-bench-typing",
    stop: async () => {
      for (const process of platform.processes) await process.stop()
    },
  }
}
