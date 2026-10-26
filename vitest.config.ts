import { defineConfig } from "vitest/config"

export const TEST_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "refs/**",
  "**/.wrangler/**",
  "**/.{idea,git,cache,output,temp}/**",
]

const TEST_CONFIG_PACKAGES = ["apps/server", "apps/web-solid"]

const isRepoRootTestRun = process.cwd() === import.meta.dirname

export default defineConfig({
  test: {
    environment: "node",
    exclude: TEST_EXCLUDE,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    allowOnly: !process.env.CI,
    retry: 0,
    fakeTimers: {
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "clearImmediate",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
      ],
    },
    ...(isRepoRootTestRun
      ? {
          projects: [
            ...TEST_CONFIG_PACKAGES,
            {
              extends: true,
              test: {
                name: "root",
                exclude: [...TEST_EXCLUDE, ...TEST_CONFIG_PACKAGES.map((dir) => `${dir}/**`)],
              },
            },
          ],
        }
      : {}),
  },
})
