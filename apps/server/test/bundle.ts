// Bundles a test worker for Miniflare, the way wrangler bundles the real one.
//
// pi-ai loads Node modules and OAuth flow modules with a computed `import()`. Wrangler
// accepts that, but Miniflare refuses a script with a dynamic specifier. The server
// never reaches those imports (provider-login.ts registers the bundled flows), so the
// test bundle replaces them with a rejection.
const DYNAMIC = /import\(__rewriteRelativeImportExtension\d*\(\w+\)\)/g

export async function bundleWorker(entry: URL): Promise<string> {
  const built = await Bun.build({
    entrypoints: [entry.pathname],
    target: "browser",
    format: "esm",
    external: ["cloudflare:workers", "node:*"],
  })
  if (!built.success) throw new Error(built.logs.join("\n"))
  const script = await built.outputs[0]!.text()
  return script.replace(DYNAMIC, 'Promise.reject(new Error("no dynamic modules in workerd"))')
}
