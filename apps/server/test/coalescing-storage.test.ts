import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"

// Experiment 3 (architecture section 17.5). Runs inside workerd, on a real Durable Object, through
// Miniflare. The worker is bundled from `coalescing-worker.ts` and the source it imports.
let mf: Miniflare

beforeAll(async () => {
  const built = await Bun.build({
    entrypoints: [new URL("./coalescing-worker.ts", import.meta.url).pathname],
    target: "browser",
    format: "esm",
    external: ["cloudflare:workers", "node:*"],
  })
  if (!built.success) throw new Error(built.logs.join("\n"))
  // pi-ai's auth context loads Node modules with a computed `import()`, which Miniflare refuses to
  // bundle. Nothing here calls it, because the faux model needs no credentials. Wrangler accepts it.
  const dynamic = "import(__rewriteRelativeImportExtension(specifier))"
  const script = await built.outputs[0]!.text()
  if (!script.includes(dynamic)) throw new Error("the pi-ai dynamic import moved; update this test")
  mf = new Miniflare({
    modules: true,
    script: script.replace(dynamic, 'Promise.reject(new Error("no node modules in workerd"))'),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { T: { className: "T", useSQLite: true } },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

async function object(id?: DurableObjectId) {
  const ns = await mf.getDurableObjectNamespace("T")
  return ns.get(id ?? ns.newUniqueId())
}

async function call<T>(body: unknown, stub?: Awaited<ReturnType<typeof object>>): Promise<T> {
  const res = await (stub ?? (await object())).fetch("http://do/", { method: "POST", body: JSON.stringify(body) })
  return (await res.json()) as T
}

type Result = { name: string; ok: boolean; error?: string }

async function runConformance(policy: string) {
  const { names } = await call<{ names: string[] }>({ op: "conformance", policy })
  const results: Result[] = []
  for (const [index] of names.entries()) results.push(await call<Result>({ op: "conformance", policy, index }))
  return results
}

// pi-durable 1.0.0 ships 23 storage conformance cases. Fewer means cases were dropped.
const CONFORMANCE_CASES = 23

test("the wrapper passes pi-durable storage conformance", async () => {
  const results = await runConformance("default")
  expect(results.filter((r) => !r.ok)).toEqual([])
  expect(results.length).toBe(CONFORMANCE_CASES)
}, 60_000)

test("the wrapper passes conformance when it holds every single-delta commit", async () => {
  const results = await runConformance("aggressive")
  expect(results.filter((r) => !r.ok)).toEqual([])
  expect(results.length).toBe(CONFORMANCE_CASES)
}, 60_000)

type Measurement = { status: string; rowsWritten: number; commits: number; held: number; answerChars: number }

test("a coalesced turn writes fewer rows and gives the same answer", async () => {
  const [plain, coalesced] = await Promise.all([
    call<Measurement>({ op: "measure", coalesce: false, ms: 4_000 }),
    call<Measurement>({ op: "measure", coalesce: true, ms: 4_000 }),
  ])
  console.log("rows per 4 s turn:", { plain, coalesced })
  for (const m of [plain, coalesced]) {
    expect(m.status).toBe("done")
    expect(m.answerChars).toBeGreaterThan(0)
  }
  expect(plain.held).toBe(0)
  // The partials of a 4 s stream fall into two or three windows.
  expect(coalesced.held).toBeGreaterThan(10)
  expect(coalesced.rowsWritten).toBeLessThan(plain.rowsWritten / 2)
}, 60_000)

type Crash = {
  info: { pending: number; memoryChars: number; storedChars: number }
  messages: { text: string; stopReason?: string }[]
  answer: string
  recovered: string
}

test("a crash inside a window still resumes to a correct answer", async () => {
  const ns = await mf.getDurableObjectNamespace("T")
  const id = ns.newUniqueId()
  // The object aborts itself mid-request, so this call fails.
  const crashed = await (await object(id)).fetch("http://do/", { method: "POST", body: JSON.stringify({ op: "crash" }) }).then(
    (res) => res.text(),
    (error: unknown) => String(error),
  )
  console.log("crash request:", crashed.slice(0, 300))
  const result = await call<Crash>({ op: "resume" }, await object(id))
  const { info, messages, answer, recovered } = result
  console.log("crash inside a window:", info)
  // The crash happened with held partials that were never written.
  expect(info.pending).toBeGreaterThan(0)
  expect(info.storedChars).toBeGreaterThan(0)
  expect(info.memoryChars).toBeGreaterThan(info.storedChars)
  // Recovery kept the stored partial as an aborted entry and sent the request again.
  expect(messages).toHaveLength(2)
  expect(messages[0]!.stopReason).toBe("aborted")
  expect(messages[0]!.text).toBe(answer.slice(0, info.storedChars))
  expect(messages[1]).toEqual({ text: recovered, stopReason: "stop" })
}, 60_000)
