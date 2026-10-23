import { createHash } from "node:crypto"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig, mergeConfig } from "vitest/config"
import rootConfig from "../../vitest.config.ts"
import appConfig from "./vite.config.ts"

const { projects: _rootProjects, ...rootTest } = rootConfig.test ?? {}

const browserApiPort =
  61_000 +
  (createHash("sha256")
    .update(import.meta.dirname)
    .digest()
    .readUInt32BE(0) %
    4_000)

export default defineConfig((env) =>
  mergeConfig(mergeConfig(appConfig(env), { test: rootTest }), {
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: "web-unit",
            include: ["src/**/*.test.{ts,tsx}"],
            exclude: [...(rootTest.exclude ?? []), "src/**/*.browser.test.{ts,tsx}"],
            hookTimeout: 15_000,
            testTimeout: 15_000,
          },
        },
        {
          extends: true,
          test: {
            name: "web-browser",
            include: ["src/**/*.browser.test.{ts,tsx}"],
            hookTimeout: 15_000,
            testTimeout: 15_000,
            api: { port: browserApiPort, strictPort: false },
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              instances: [{ browser: "chromium" }],
              screenshotFailures: false,
            },
          },
        },
      ],
    },
  }),
)
