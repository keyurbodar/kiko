import { defineConfig, mergeConfig } from "vitest/config"
import rootConfig from "../../vitest.config.ts"

const { projects: _rootProjects, ...rootTest } = rootConfig.test ?? {}

export default defineConfig(
  mergeConfig(
    { test: rootTest },
    {
      test: {
        projects: [
          { extends: true, test: { name: "server", include: ["src/**/*.test.ts"] } },
          {
            extends: true,
            test: {
              name: "worker",
              include: ["integration/**/*.integration.test.ts"],
              hookTimeout: 300_000,
              testTimeout: 300_000,
            },
          },
        ],
      },
    },
  ),
)
