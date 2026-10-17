import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import { buildCatalog, catalogFile, type CatalogFile } from "../../scripts/build-catalog";
import pkg from "../../package.json";

const CATALOG_MODULE = "virtual:kiko-model-catalog";

// Emits the pi-ai catalog as a hashed asset. The only code that learns its url is the module
// `virtual:kiko-model-catalog`, which the settings route imports lazily.
function modelCatalog(): Plugin {
  let file: CatalogFile | undefined;
  const load = async () => (file ??= catalogFile(await buildCatalog()));
  const urlPath = (name: string) => `/assets/${name}`;
  return {
    name: "kiko-model-catalog",
    resolveId(id) {
      return id === CATALOG_MODULE ? `\0${CATALOG_MODULE}` : undefined;
    },
    async load(id) {
      if (id !== `\0${CATALOG_MODULE}`) return undefined;
      return `export default ${JSON.stringify(urlPath((await load()).fileName))};`;
    },
    async generateBundle() {
      const { fileName, json } = await load();
      this.emitFile({ type: "asset", fileName: `assets/${fileName}`, source: json });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void (async () => {
          const { fileName, json } = await load();
          if (request.url?.split("?")[0] !== urlPath(fileName)) return next();
          response.setHeader("content-type", "application/json");
          response.end(json);
        })();
      });
    },
  };
}

// A hosted build (one with a Clerk key) sends people to the installer, so it cannot ship without one.
function requireInstaller(mode: string): void {
  const env = { ...loadEnv(mode, import.meta.dirname, "VITE_"), ...process.env };
  if (mode === "production" && env.VITE_CLERK_PUBLISHABLE_KEY && !env.VITE_INSTALLER_URL) {
    throw new Error("VITE_CLERK_PUBLISHABLE_KEY is set but VITE_INSTALLER_URL is not. Set it to the installer Worker's URL.");
  }
}

export default defineConfig(({ mode }) => {
  requireInstaller(mode);
  return {
  plugins: [solid(), tailwindcss(), modelCatalog()],
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
};
});
