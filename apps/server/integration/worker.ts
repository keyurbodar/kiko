import { randomBytes } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unstable_startWorker } from "wrangler"

export type LocalWorker = AsyncDisposable & { readonly url: URL }

export async function startLocalWorker(): Promise<LocalWorker> {
  const dir = await mkdtemp(join(tmpdir(), "kiko-worker-"))
  const assets = join(dir, "assets")
  await mkdir(assets)
  await writeFile(join(dir, "empty"), "")
  const worker = await unstable_startWorker({
    config: join(import.meta.dirname, "..", "wrangler.jsonc"),
    envFiles: [join(dir, "empty")],
    assets,
    build: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
    bindings: {
      SESSION_SECRET: { type: "secret_text", value: randomBytes(32).toString("hex") },
      CREDENTIALS_KEK: { type: "secret_text", value: randomBytes(32).toString("base64") },
    },
    dev: {
      persist: join(dir, "state"),
      server: { hostname: "127.0.0.1", port: 0 },
      inspector: false,
      watch: false,
      logLevel: "warn",
    },
  })
  try {
    await worker.ready
    const url = await worker.url
    return {
      url,
      async [Symbol.asyncDispose]() {
        try {
          await worker.dispose()
        } finally {
          await rm(dir, { recursive: true, force: true })
        }
      },
    }
  } catch (error) {
    await worker.dispose()
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}
