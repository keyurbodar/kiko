import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import { defineConfig, loadEnv, type Plugin } from "vite"
import solid from "vite-plugin-solid"
import pkg from "../../package.json" with { type: "json" }

const SW_KILL_SWITCH = `self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.map((name) => caches.delete(name))))
      .then(() => self.registration.unregister()),
  )
})
`

const swKillSwitch: Plugin = {
  name: "kiko-sw-kill-switch",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "sw.js", source: SW_KILL_SWITCH })
  },
}

function shipEveryStylesheet(): Plugin {
  const imported = new Set<string>()
  return {
    name: "kiko-ship-every-stylesheet",
    apply: "build",
    transform(_code, id) {
      if (id.endsWith(".css") && !id.includes("?")) imported.add(id)
    },
    generateBundle(_options, bundle) {
      const shipped = new Set(
        Object.values(bundle).flatMap((output) => (output.type === "chunk" ? Object.keys(output.modules) : [])),
      )
      const dropped = [...imported].filter((id) => !shipped.has(id))
      if (dropped.length > 0) {
        this.error(
          `These stylesheets were imported but tree-shaken out of the build. Import each one from the module that defines its component, not from a re-export:\n${dropped.join("\n")}`,
        )
      }
    },
  }
}

function requireInstaller(mode: string): void {
  const env = { ...loadEnv(mode, import.meta.dirname, "VITE_"), ...process.env }
  if (mode === "production" && env.VITE_CLERK_PUBLISHABLE_KEY && !env.VITE_INSTALLER_URL) {
    throw new Error(
      "VITE_CLERK_PUBLISHABLE_KEY is set but VITE_INSTALLER_URL is not. Set it to the installer Worker's URL.",
    )
  }
}

export default defineConfig(({ mode }) => {
  requireInstaller(mode)
  return {
    plugins: [tanstackRouter({ target: "solid" }), solid(), tailwindcss(), swKillSwitch, shipEveryStylesheet()],
    define: { __KIKO_VERSION__: JSON.stringify(pkg.version) },
    optimizeDeps: {
      include: [
        "@kiko/ui > @kobalte/core > @internationalized/date",
        "@kiko/ui > @kobalte/core > @internationalized/number",
      ],
    },
    server: {
      port: 3001,
      proxy: { "/api": { target: `http://localhost:${process.env.KIKO_SERVER_PORT ?? 8787}`, ws: true } },
    },
    build: {
      manifest: true,
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, "index.html"),
        },
      },
    },
  }
})
