import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { firstPaintPreload } from "./scripts/preload-plugin";
import pkg from "../../package.json";

export default defineConfig({
  plugins: [solid(), tailwindcss(), firstPaintPreload()],
  // The build version, from the root package.json. The client compares it with the backend (src/lib/version-skew.ts).
  define: { __KIKO_VERSION__: JSON.stringify(pkg.version) },
  optimizeDeps: {
    // Plain JS that Kobalte (kept out of the optimizer by vite-plugin-solid) imports file by file.
    include: ["@kiko/ui > @kobalte/core > @internationalized/date", "@kiko/ui > @kobalte/core > @internationalized/number"],
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
});
