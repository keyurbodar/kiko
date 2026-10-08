// Bundles a test worker for Miniflare, the way wrangler bundles the real one.
//
// The build runs in its own `bun build` process. Bun.build inside `bun test` shares the test
// process's module cache, so a source file the test also imports could come back with exports
// missing, or a relative import would not resolve.
//
// pi-ai loads Node modules and OAuth flow modules with a computed `import()`. Wrangler
// accepts that, but Miniflare refuses a script with a dynamic specifier. The server
// never reaches those imports (provider-login.ts registers the bundled flows), so the
// test bundle replaces them with a rejection.
const DYNAMIC = /import\(__rewriteRelativeImportExtension\d*\(\w+\)\)/g

export async function bundleWorker(entry: URL, define: Record<string, string> = {}): Promise<string> {
  const args = ["bun", "build", entry.pathname, "--target=browser", "--format=esm", "--external=cloudflare:workers", "--external=node:*"]
  for (const [key, value] of Object.entries(define)) args.push(`--define=${key}=${value}`)
  const run = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  const [script, errors, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited])
  if (code !== 0) throw new Error(errors)
  return script.replace(DYNAMIC, 'Promise.reject(new Error("no dynamic modules in workerd"))')
}
