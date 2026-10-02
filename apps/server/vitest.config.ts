import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Pure-function tests run inside workerd with the same compatibility settings as the Worker.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: { compatibilityDate: "2026-08-01", compatibilityFlags: ["nodejs_compat"] },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
