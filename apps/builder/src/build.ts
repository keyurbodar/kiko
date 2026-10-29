import * as esbuild from "esbuild-wasm/esm/browser.js"
import esbuildWasm from "esbuild-wasm/esbuild.wasm"
import {
  ANONYMOUS_ARTIFACT_FORMAT,
  ANONYMOUS_FETCH_DIAGNOSTIC,
  DEFAULT_ANONYMOUS_LIMITS,
  LAKEBED_VERSION,
  sha256,
  stableStringify,
  validateAnonymousArtifact,
} from "lakebed/anonymous"
import { QuickJS } from "quickjs-wasi"
import quickjsWasm from "quickjs-wasi/quickjs.wasm"
import { compile } from "tailwindcss"
import vendor from "./vendor.json"

export type Target = "anonymous" | "claimed"
export type Diagnostic = { path?: string; line?: number; message: string; code?: string }
export type Envelope = { artifact: unknown; artifactHash: string; clientBundle: string; clientBundleHash: string }
export type BuildResult =
  | { ok: true; envelope: Envelope; timings: Record<string, number> }
  | { ok: false; diagnostics: Diagnostic[] }

type SourceFile = { bytes: number; contents: string; hash: string; path: string }
type Manifest = {
  ok: boolean
  name?: string
  favicon: string | null
  faviconError?: string
  schema: { diagnostics: Diagnostic[]; schema: unknown }
  endpoints: { diagnostics: Diagnostic[]; endpoints: unknown }
  auth: { diagnostics: Diagnostic[]; auth: unknown }
  actions: string[]
  mutations: string[]
  queries: string[]
  forbidden: Diagnostic[]
  database: { apiVersion: unknown; indexCodecVersion: unknown; maxIndexKeyBytes: unknown }
}

const ROOT = "/w"
const NM = `${ROOT}/node_modules`
const SOURCE = "lakebed-source"
const BUILD_DIR = `${ROOT}/.lakebed/build/kiko`
const ANONYMOUS_FETCH_CODE = "anonymous_fetch"
const EVAL_TIMEOUT_MS = 5_000
const EVAL_MEMORY_LIMIT = 64 * 1024 * 1024
class CapsuleError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => d.message).join("\n"))
  }
}

const LAKEBED_CONFIG_FILE = "lakebed.json"
const SERVER_ENV_FILE = ".env.lakebed.server"
const CLIENT_ENTRY = "__lakebed/client-entry.tsx"
const CLIENT_ENTRY_SOURCE = `import { h, render } from "preact";\nimport { ErrorBoundary } from "lakebed/client";\nimport { App } from "../client/index.tsx";\n\nrender(h(ErrorBoundary, {}, h(App, {})), document.getElementById("app"));\n`
const STUB_NODE =
  "export function createHash(){throw new Error('unavailable')};export function randomUUID(){return ''};export function randomBytes(){return new Uint8Array()}"
const QUICKJS_TEXT = `globalThis.TextEncoder=class{get encoding(){return "utf-8"}encode(s=""){const u=unescape(encodeURIComponent(s));const a=new Uint8Array(u.length);for(let i=0;i<u.length;i++)a[i]=u.charCodeAt(i);return a}};globalThis.TextDecoder=class{decode(b){const a=b instanceof Uint8Array?b:new Uint8Array(b||[]);let s="";for(const c of a)s+=String.fromCharCode(c);return decodeURIComponent(escape(s))}};\n`

const files = new Map(Object.entries(vendor.files).map(([path, text]) => [`${NM}/${path}`, text]))
const preactExports = JSON.parse(files.get(`${NM}/preact/package.json`) ?? "{}").exports as Record<
  string,
  Record<string, unknown>
>

let ready: Promise<void> | undefined

const dirname = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : "")

function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.split("/")) {
    if (part === "..") parts.pop()
    else if (part && part !== ".") parts.push(part)
  }
  return (path.startsWith("/") ? "/" : "") + parts.join("/")
}

function probe(has: (path: string) => boolean, path: string): string | undefined {
  const ends = ["", ".ts", ".tsx", ".js", ".jsx", ".json", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"]
  return ends.map((end) => `${path}${end}`).find(has)
}

function loaderFor(path: string): esbuild.Loader {
  if (path.endsWith(".tsx")) return "tsx"
  if (path.endsWith(".ts") || path.endsWith(".js")) return "ts"
  if (path.endsWith(".jsx")) return "jsx"
  if (path.endsWith(".json")) return "json"
  return "js"
}

function bare(spec: string): string | undefined {
  if (spec === "lakebed/client") return `${NM}/lakebed/dist/client.js`
  if (spec !== "preact" && !spec.startsWith("preact/")) return undefined
  const entry = preactExports[spec === "preact" ? "." : `./${spec.slice("preact/".length)}`]
  const target = entry?.browser ?? entry?.import ?? entry?.default
  return typeof target === "string" ? normalize(`${NM}/preact/${target}`) : undefined
}

function withInlineMap(path: string): string {
  const code = files.get(path) ?? ""
  const match = code.match(/\n\/\/# sourceMappingURL=(\S+)\s*$/)
  if (!match?.[1] || match[1].startsWith("data:")) return code
  const map = files.get(normalize(`${dirname(path)}/${match[1]}`))
  if (!map) return code
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(map)))
  return `${code.slice(0, match.index)}\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`
}

function sourcePlugin(source: Map<string, string>, target: "server" | "client", serverSdk = "dist/server.js") {
  const allowed = target === "server" ? "lakebed/server" : "lakebed/client, preact, preact/*"
  const inSource = (path: string) => probe((p) => source.has(p), path)
  const resolveVendor = (path: string, importer: string) => {
    if (!path.startsWith(".")) return { path: bare(path), namespace: "file" }
    return { path: probe((p) => files.has(p), normalize(`${dirname(importer)}/${path}`)), namespace: "file" }
  }
  const resolveSource = (spec: string, importer: string) => {
    const base = spec.startsWith("/") ? "" : dirname(importer)
    const path = inSource(normalize(`${base}/${spec}`).replace(/^\//, ""))
    if (path) return { path, namespace: SOURCE }
    return { errors: [{ text: `Unable to resolve the import ${spec}. Nothing in this capsule matches it.` }] }
  }
  const resolveBare = (spec: string) => {
    if (target === "server" && spec === "lakebed/server")
      return { path: `${NM}/lakebed/${serverSdk}`, namespace: "file" }
    if (target === "server") return { path: spec, external: true }
    const resolved = bare(spec)
    if (resolved) return { path: resolved, namespace: "file" }
    return { errors: [{ text: `${spec} is an npm package, and Lakebed v0 cannot install packages. Use ${allowed}.` }] }
  }
  return {
    name: "lakebed-source-store",
    setup(build: esbuild.PluginBuild) {
      build.onResolve({ filter: /^node:/ }, (args) =>
        args.namespace === SOURCE
          ? { errors: [{ text: `${args.path} is a Node built-in, and Lakebed ${target} modules do not run on Node.` }] }
          : { path: args.path, namespace: "stub" },
      )
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: STUB_NODE, loader: "js" }))
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return { path: inSource(args.path), namespace: SOURCE }
        if (args.path.startsWith("/") && files.has(args.path)) return { path: args.path, namespace: "file" }
        if (args.namespace !== SOURCE) return resolveVendor(args.path, args.importer)
        if (args.path.startsWith(".") || args.path.startsWith("/")) return resolveSource(args.path, args.importer)
        return resolveBare(args.path)
      })
      build.onLoad({ filter: /.*/, namespace: SOURCE }, (args) => ({
        contents: source.get(args.path) ?? "",
        loader: loaderFor(args.path),
        resolveDir: dirname(args.path),
      }))
      build.onLoad({ filter: /.*/, namespace: "file" }, (args) => ({
        contents: withInlineMap(args.path),
        loader: "js",
        resolveDir: dirname(args.path),
      }))
    },
  }
}

function inputsOf(result: esbuild.BuildResult<{ metafile: true }>): string[] {
  return Object.keys(result.metafile.inputs)
    .filter((path) => path.startsWith(`${SOURCE}:`))
    .map((path) => path.slice(SOURCE.length + 1))
    .sort()
}

function esbuildDiagnostics(error: unknown): Diagnostic[] | null {
  const failure = error as { errors?: esbuild.Message[] }
  if (!Array.isArray(failure.errors)) return null
  return failure.errors.map((m) => ({
    path: m.location?.file.replace(`${SOURCE}:`, ""),
    line: m.location?.line,
    message: m.text,
  }))
}

async function readSourceFiles(source: Map<string, string>): Promise<SourceFile[]> {
  const out: SourceFile[] = []
  for (const [path, contents] of source) {
    if (path.startsWith("__") || path === LAKEBED_CONFIG_FILE || path === SERVER_ENV_FILE) continue
    const bytes = new TextEncoder().encode(contents)
    out.push({ bytes: bytes.byteLength, contents, hash: sha256(bytes), path })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

const MANIFEST_ENTRY = `import app from "./server/index.ts";
import { forbiddenSourceDiagnostics, serializeSchema, serializeEndpoints, serializeAuth } from "${NM}/lakebed/dist/anonymous/source-scan.js";
import { DATABASE_API_VERSION, INDEX_CODEC_VERSION, MAX_INDEX_KEY_BYTES } from "${NM}/lakebed/dist/database/schema.js";
import { rec } from "${NM}/lakebed/dist/anonymous/json.js";
import { validateFaviconPath } from "${NM}/lakebed/dist/favicon.js";
const input = globalThis.__input;
let favicon = null, faviconError;
try { if (typeof app?.favicon === "string") favicon = validateFaviconPath(app.favicon); else if (app?.favicon != null) faviconError = "capsule({ favicon }) must be a relative .svg or .ico path string."; } catch (e) { faviconError = e.message; }
globalThis.__out = JSON.stringify({
  ok: !!app && typeof app === "object" && typeof app.__lakebedCreateDb === "function",
  name: app?.name, favicon, faviconError,
  schema: serializeSchema(rec(app?.schema)), endpoints: serializeEndpoints(rec(app?.endpoints)), auth: serializeAuth(app ?? {}),
  actions: Object.keys(app?.actions ?? {}), mutations: Object.keys(app?.mutations ?? {}), queries: Object.keys(app?.queries ?? {}),
  forbidden: forbiddenSourceDiagnostics(input.files, input.options),
  database: { apiVersion: DATABASE_API_VERSION, indexCodecVersion: INDEX_CODEC_VERSION, maxIndexKeyBytes: MAX_INDEX_KEY_BYTES },
});`

const TOOLS_ENTRY = `import app from "./server/index.ts";
import { serializeTools } from "${NM}/lakebed/dist/tools.js";
globalThis.__out = JSON.stringify(serializeTools(app ?? {}));`

async function evaluate(source: Map<string, string>, entry: string, serverSdk: string, input: unknown) {
  const built = await esbuild.build({
    bundle: true,
    write: false,
    format: "iife",
    platform: "neutral",
    mainFields: ["module", "main"],
    jsx: "automatic",
    jsxImportSource: "preact",
    absWorkingDir: ROOT,
    entryPoints: [entry],
    outfile: "/eval.js",
    plugins: [sourcePlugin(source, "server", serverSdk)],
  })
  const deadline = Date.now() + EVAL_TIMEOUT_MS
  const vm = await QuickJS.create({
    wasm: quickjsWasm,
    memoryLimit: EVAL_MEMORY_LIMIT,
    interruptHandler: () => Date.now() > deadline,
  })
  try {
    vm.setProp(vm.global, "__input", vm.hostToHandle(input))
    vm.evalCode(QUICKJS_TEXT + (built.outputFiles[0]?.text ?? "")).dispose()
    return JSON.parse(vm.evalCode("globalThis.__out").consume((h) => h.toString()))
  } catch (error) {
    if (Date.now() > deadline)
      throw new CapsuleError([
        { path: "server/index.ts", message: `The server code ran longer than ${EVAL_TIMEOUT_MS / 1000} seconds.` },
      ])
    const handle = (error as { handle?: Parameters<typeof vm.dump>[0] }).handle
    const dumped = handle ? (vm.dump(handle) as { message?: string }) : null
    throw new CapsuleError([{ path: "server/index.ts", message: dumped?.message ?? String(error) }])
  } finally {
    vm.dispose()
  }
}

const FAVICON_MAX_BYTES = 64 * 1024

function faviconOf(manifest: Manifest, source: Map<string, string>) {
  if (manifest.faviconError) throw new CapsuleError([{ path: "server/index.ts", message: manifest.faviconError }])
  const path =
    manifest.favicon ?? (source.has("favicon.svg") ? "favicon.svg" : source.has("favicon.ico") ? "favicon.ico" : null)
  if (!path) return null
  const text = source.get(path)
  if (text === undefined) throw new CapsuleError([{ path, message: `Capsule favicon file not found: ${path}` }])
  if (!path.endsWith(".svg"))
    throw new CapsuleError([{ path, message: "Use an .svg favicon. Kiko does not build .ico files yet." }])
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength > FAVICON_MAX_BYTES)
    throw new CapsuleError([{ path, message: `Capsule favicon ${path} exceeds ${FAVICON_MAX_BYTES} bytes.` }])
  return {
    bodyBase64: base64(bytes),
    bytes: bytes.byteLength,
    contentType: "image/svg+xml",
    hash: sha256(bytes),
    routePath: "/favicon.svg",
    sourcePath: path,
  }
}

function limitsOf(maxIndexKeyBytes: unknown) {
  const l = DEFAULT_ANONYMOUS_LIMITS
  return {
    maxRowsReturned: l.rowsReturned,
    maxValueBytes: l.maxValueBytes,
    maxIndexKeyBytes,
    maxRowsRead: l.databaseRowsRead,
    maxBytesRead: l.databaseBytesRead,
    maxDirectGets: l.databaseDirectGets,
    maxScanCalls: l.databaseScanCalls,
    maxWrites: l.databaseWrites,
  }
}

const sourceOps = (names: string[]) => Object.fromEntries(names.map((name) => [name, { op: "source" }]))

function base64(bytes: Uint8Array): string {
  let text = ""
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

async function bundles(source: Map<string, string>) {
  const common = { bundle: true, write: false, format: "esm", jsx: "automatic", jsxImportSource: "preact" } as const
  const server = await esbuild.build({
    ...common,
    absWorkingDir: ROOT,
    entryPoints: ["server/index.ts"],
    outfile: `${BUILD_DIR}/server.mjs`,
    platform: "node",
    metafile: true,
    sourcemap: "inline",
    plugins: [sourcePlugin(source, "server")],
  })
  const client = await esbuild.build({
    ...common,
    absWorkingDir: ROOT,
    entryPoints: [CLIENT_ENTRY],
    outfile: `${BUILD_DIR}/client.js`,
    platform: "browser",
    metafile: true,
    minify: true,
    plugins: [sourcePlugin(source, "client")],
  })
  return { server, client }
}

function styles(source: Map<string, string>, clientInputs: string[]): Promise<string> {
  const candidates = new Set<string>()
  for (const path of clientInputs) {
    for (const token of (source.get(path) ?? "").split(/[\s"'`{}<>;]+/)) if (token) candidates.add(token)
  }
  return compile(vendor.tailwindCss).then((compiler) => compiler.build([...candidates]))
}

async function assemble(source: Map<string, string>, target: Target) {
  const { server, client } = await bundles(source)
  const serverInputs = inputsOf(server)
  const clientInputs = inputsOf(client).filter((path) => !path.startsWith("__lakebed/"))
  const css = await styles(source, clientInputs)
  const sourceFiles = await readSourceFiles(source)
  const anonymous = target === "anonymous"
  const manifest = (await evaluate(source, "__kiko/manifest.ts", "dist/server.js", {
    files: sourceFiles,
    options: { rejectLegacyDatabaseApi: anonymous, serverInputs },
  })) as Manifest
  const tools = (await evaluate(source, "__kiko/tools.ts", "dist/server-tools.js", null)) as Record<string, unknown>
  const diagnostics = [
    ...manifest.forbidden
      .filter((d) => anonymous || d.message !== ANONYMOUS_FETCH_DIAGNOSTIC)
      .map((d) => (d.message === ANONYMOUS_FETCH_DIAGNOSTIC ? { ...d, code: ANONYMOUS_FETCH_CODE } : d)),
    ...manifest.schema.diagnostics,
    ...manifest.endpoints.diagnostics,
    ...manifest.auth.diagnostics,
  ]
  if (!manifest.ok)
    diagnostics.push({
      path: "server/index.ts",
      message: 'The server default export must use capsule({...}) from "lakebed/server".',
    })
  if (diagnostics.length > 0) throw new CapsuleError(diagnostics)
  const toolsCode = Object.keys(tools).length > 0 ? `globalThis.__LAKEBED_TOOLS__=${JSON.stringify(tools)};` : ""
  const clientBytes = new TextEncoder().encode(
    `${toolsCode}{const style=document.createElement("style");style.textContent=${JSON.stringify(css)};document.head.appendChild(style);}\n${client.outputFiles[0]?.text ?? ""}`,
  )
  const serverBytes = server.outputFiles[0]?.contents ?? new Uint8Array()
  const favicon = faviconOf(manifest, source)
  const fileList = sourceFiles.map(({ bytes, hash, path }) => ({ bytes, hash, path }))
  const artifact = {
    database: {
      apiVersion: manifest.database.apiVersion,
      indexCodecVersion: manifest.database.indexCodecVersion,
      schemaHash: sha256(stableStringify(manifest.schema.schema) ?? ""),
    },
    name: manifest.name ?? "Lakebed Capsule",
    client: { bundleHash: sha256(clientBytes), bytes: clientBytes.byteLength, entry: "/client.js", styles: "bundled" },
    createdWith: { compiler: "0.1.0", lakebed: LAKEBED_VERSION },
    ...(favicon ? { favicon } : {}),
    format: ANONYMOUS_ARTIFACT_FORMAT,
    limits: limitsOf(manifest.database.maxIndexKeyBytes),
    server: {
      actions: sourceOps(manifest.actions),
      auth: manifest.auth.auth,
      endpoints: manifest.endpoints.endpoints,
      helpers: {},
      imports: ["lakebed/server"],
      mutations: sourceOps(manifest.mutations),
      queries: sourceOps(manifest.queries),
      schema: manifest.schema.schema,
      source: {
        bytes: serverBytes.byteLength,
        bundle: base64(serverBytes),
        bundleHash: sha256(serverBytes),
        entry: "/server.mjs",
      },
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
    },
    source: { files: fileList, snapshotHash: sha256(stableStringify(fileList) ?? "") },
    deployTarget: anonymous ? "anonymous-source" : "claimed-source",
  }
  const invalid = validateAnonymousArtifact(artifact, { allowClaimedSource: !anonymous }) as Diagnostic[]
  if (invalid.length > 0) throw new CapsuleError(invalid)
  return {
    artifact,
    artifactHash: sha256(stableStringify(artifact) ?? ""),
    clientBundle: base64(clientBytes),
    clientBundleHash: sha256(clientBytes),
  }
}

export async function buildCapsule(input: Record<string, string>, target: Target): Promise<BuildResult> {
  ready ??= esbuild.initialize({ wasmModule: esbuildWasm, worker: false })
  await ready
  const started = Date.now()
  const source = new Map(Object.entries(input))
  if (!source.has("server/index.ts"))
    return {
      ok: false,
      diagnostics: [{ path: "server/index.ts", message: "Missing the capsule server entry server/index.ts." }],
    }
  if (!source.has("client/index.tsx"))
    return {
      ok: false,
      diagnostics: [{ path: "client/index.tsx", message: "Missing the capsule client entry client/index.tsx." }],
    }
  source.set(CLIENT_ENTRY, CLIENT_ENTRY_SOURCE)
  source.set("__kiko/manifest.ts", MANIFEST_ENTRY.replace("./server/index.ts", "../server/index.ts"))
  source.set("__kiko/tools.ts", TOOLS_ENTRY.replace("./server/index.ts", "../server/index.ts"))
  try {
    const envelope = await assemble(source, target)
    return { ok: true, envelope, timings: { totalMs: Date.now() - started } }
  } catch (error) {
    if (error instanceof CapsuleError) return { ok: false, diagnostics: error.diagnostics }
    const diagnostics = esbuildDiagnostics(error)
    if (diagnostics) return { ok: false, diagnostics }
    throw error
  }
}
