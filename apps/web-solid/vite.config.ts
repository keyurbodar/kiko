import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, loadEnv } from "vite"
import solid from "vite-plugin-solid"
import { firstPaintPreload } from "./scripts/preload-plugin.ts"
import { serviceWorker } from "./scripts/service-worker-plugin.ts"
import pkg from "../../package.json" with { type: "json" }

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
    plugins: [solid(), tailwindcss(), firstPaintPreload(), serviceWorker()],
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
