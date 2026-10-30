import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"
import appConfig from "../../vite.config.ts"

const appRoot = new URL("../..", import.meta.url).pathname

export default defineConfig((env) => {
  const app = appConfig(env)
  return {
    root: appRoot,
    plugins: app.plugins,
    define: app.define,
    optimizeDeps: app.optimizeDeps,
    resolve: app.resolve,
    test: {
      name: "hot-path-bench",
      include: ["test/bench/**/*.browser.bench.ts"],
      hookTimeout: 120_000,
      testTimeout: 600_000,
      retry: 0,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: "chromium" }],
        screenshotFailures: false,
        api: { port: 62_731, strictPort: false },
      },
    },
  }
})
