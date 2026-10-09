import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import { buildCatalog, catalogFile, type CatalogFile } from "../../scripts/build-catalog";

const CATALOG_MODULE = "virtual:yuki-model-catalog";

// Emits the pi-ai catalog as a hashed asset. The only code that learns its url is the module
// `virtual:yuki-model-catalog`, which the settings route imports lazily.
function modelCatalog(): Plugin {
  let file: CatalogFile | undefined;
  const load = async () => (file ??= catalogFile(await buildCatalog()));
  const urlPath = (name: string) => `/assets/${name}`;
  return {
    name: "yuki-model-catalog",
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

export default defineConfig({
  plugins: [solid(), tailwindcss(), modelCatalog()],
  optimizeDeps: {
    // Plain JS that Kobalte (kept out of the optimizer by vite-plugin-solid) imports file by file.
    include: ["@yuki/ui > @kobalte/core > @internationalized/date", "@yuki/ui > @kobalte/core > @internationalized/number"],
  },
  server: {
    port: 3001,
    proxy: { "/api": { target: `http://localhost:${process.env.YUKI_SERVER_PORT ?? 8787}`, ws: true } },
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
