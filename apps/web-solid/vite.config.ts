import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    port: 3001,
  },
  build: {
    rollupOptions: {
      // Multi-page: the composed app, plus a harness entry per slice. Each
      // harness is its own entry so a slice can be opened, probed, and judged
      // without booting the whole product around it.
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        "chat-harness": resolve(import.meta.dirname, "src/chat/harness.html"),
      },
    },
  },
});
