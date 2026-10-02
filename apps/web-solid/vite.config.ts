import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import { buildCatalog, catalogFile, type CatalogFile } from "../../scripts/build-catalog";

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

/*
 * Dev only. `import { X } from "lucide-solid"` loads the package's source barrel, which imports
 * every icon: about 1,800 module requests on the first dev load, because vite-plugin-solid keeps
 * packages with a `solid` export condition out of the dependency optimizer. This rewrites each
 * named import to the icon's own module, `lucide-solid/icons/<name>`. The build is unchanged:
 * it tree-shakes the barrel.
 */
function lucideDeepImports(): Plugin {
  let icons: Map<string, string> | undefined
  const load = () => {
    if (icons) return icons
    icons = new Map()
    const dist = resolve(dirname(createRequire(import.meta.url).resolve("lucide-solid")), "../source")
    for (const file of ["icons/index.jsx", "aliases/aliases.jsx"]) {
      const text = readFileSync(resolve(dist, file), "utf8")
      const files = new Map<string, string>()
      for (const m of text.matchAll(/import\s*\{\s*default as (\w+)\s*\}\s*from\s*"[^"]*\/([^"/]+)"/g)) files.set(m[1]!, m[2]!)
      for (const m of text.matchAll(/^\s+(\w+) as (\w+),?$/gm)) {
        const icon = files.get(m[1]!)
        if (icon) icons.set(m[2]!, icon)
      }
    }
    return icons
  }
  return {
    name: "kiko-lucide-deep-imports",
    apply: "serve",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("/node_modules/") || !code.includes("lucide-solid")) return undefined
      const out = code.replace(/import\s*\{([^}]*)\}\s*from\s*["']lucide-solid["'];?/g, (whole, list: string) => {
        const names = list.split(",").map((part) => part.trim()).filter(Boolean)
        const lines = names.map((spec) => {
          const [name, local = name] = spec.split(/\s+as\s+/)
          const icon = load().get(name!)
          return icon ? `import ${local} from "lucide-solid/icons/${icon}";` : undefined
        })
        // Same line count, so the source map of everything below stays right.
        return lines.every(Boolean) ? lines.join(" ") + "\n".repeat(whole.split("\n").length - 1) : whole
      })
      return out === code ? undefined : { code: out, map: null }
    },
  }
}

export default defineConfig({
  plugins: [lucideDeepImports(), solid(), tailwindcss(), modelCatalog()],
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
