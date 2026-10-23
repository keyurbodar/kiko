import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { transformWithOxc, type Plugin } from "vite"

const SKIPPED_FACADES = ["src/app/clerk.ts"]
const WORKER_SOURCE = new URL("./service-worker.ts", import.meta.url)

export function serviceWorker(): Plugin {
  return {
    name: "kiko-service-worker",
    apply: "build",
    async generateBundle(_options, bundle) {
      const skipped = new Set<string>()
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk" || !SKIPPED_FACADES.some((key) => item.facadeModuleId?.endsWith(key))) continue
        skipped.add(item.fileName)
        for (const css of item.viteMetadata?.importedCss ?? []) skipped.add(css)
      }
      const assets = Object.keys(bundle)
        .filter((file) => file.startsWith("assets/") && !file.endsWith(".map"))
        .map((file) => `/${file}`)
        .sort()
      const precache = assets.filter((url) => /\.(js|css)$/.test(url) && !skipped.has(url.slice(1)))
      const version = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 16)
      this.emitFile({
        type: "asset",
        fileName: "sw-manifest.json",
        source: JSON.stringify({ version, assets, precache }),
      })
      const worker = await transformWithOxc(readFileSync(WORKER_SOURCE, "utf8"), WORKER_SOURCE.pathname, {
        lang: "ts",
      })
      this.emitFile({ type: "asset", fileName: "sw.js", source: worker.code })
    },
  }
}
