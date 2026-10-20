import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import { Miniflare } from "miniflare"
import { listDays, readDay, writeDay, type ArchiveBucket } from "../src/owner/archive"

let mf: Miniflare
let bucket: Awaited<ReturnType<Miniflare["getR2Bucket"]>>

setDefaultTimeout(120_000)

beforeAll(async () => {
  const source = await Bun.file(new URL("../src/owner/archive.ts", import.meta.url)).text()
  const script = await new Bun.Transpiler({ loader: "ts", target: "browser" }).transform(source)
  mf = new Miniflare({
    modules: true,
    compatibilityDate: "2026-07-01",
    r2Buckets: ["ARCHIVE"],
    script: `${script}
      export default {
        async fetch(request, env) {
          const { roomId, day, rows } = await request.json()
          await writeDay(env.ARCHIVE, roomId, day, rows)
          return Response.json(await readDay(env.ARCHIVE, roomId, day))
        }
      }
    `,
  })
  bucket = await mf.getR2Bucket("ARCHIVE")
}, 120_000)

afterAll(async () => { await mf?.dispose() }, 120_000)

function row(seq: number) {
  return {
    id: `message-${seq}`,
    seq,
    at: Date.parse("2026-10-01T12:00:00.000Z") + seq,
    message: {
      text: `Reply ${seq}: café 🌱\nA second line with a tab\tand a quote "`,
      rich: [{ type: "text", text: `A rich reply ${seq}` }, { type: "image", url: `r2://image-${seq}` }],
      from: { kind: "agent", slug: "kiko" },
      replyTo: "previous-message",
      files: [{ name: "résumé.pdf", size: 128, mime: "application/pdf" }],
      event: { kind: "tool", payload: { args: { query: `search ${seq}` }, result: [null, true, 42] } },
    },
    fingerprint: `fingerprint-${seq}`,
    preview: { text: "Earlier reply", from: { kind: "human" } },
    deletedAt: null,
  }
}

async function roundTrip(roomId: string, rows: ReturnType<typeof row>[]) {
  const response = await mf.dispatchFetch("http://localhost/archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId, day: "2026-10-01", rows }),
  })
  expect(response.status).toBe(200)
  return response.json()
}

test("workerd gzip JSONL round trip preserves rich payloads and row order", async () => {
  const rows = [row(3), row(1), row(2)]
  expect(await roundTrip("rich", rows)).toEqual(rows)
  const object = await bucket.get("archive/rich/2026-10-01.jsonl.gz")
  expect(object).not.toBeNull()
  if (!object) throw new Error("Missing archive object")
  const bytes = new Uint8Array(await object.arrayBuffer())
  expect([...bytes.slice(0, 2)]).toEqual([0x1f, 0x8b])
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
  expect(await new Response(stream).text()).toBe(rows.map((value) => `${JSON.stringify(value)}\n`).join(""))
})

test("rewriting one day replaces one deterministic key", async () => {
  await roundTrip("rewrite", [row(1), row(2)])
  expect(await roundTrip("rewrite", [row(5)])).toEqual([row(5)])
  const page = await bucket.list({ prefix: "archive/rewrite/" })
  expect(page.objects.map((object) => object.key)).toEqual(["archive/rewrite/2026-10-01.jsonl.gz"])
})

test("missing days are null, empty days are arrays, and rooms are isolated", async () => {
  expect(await readDay(bucket, "absent", "2026-10-01")).toBeNull()
  await writeDay(bucket, "empty", "2026-10-01", [])
  expect(await readDay(bucket, "empty", "2026-10-01")).toEqual([])
  expect(await readDay(bucket, "empty", "2026-10-02")).toBeNull()
  expect(await listDays(bucket, "absent")).toEqual([])
})

test("lists every real R2 page newest first and excludes unrelated objects", async () => {
  const days = ["2024-02-29", "2026-01-01", "2026-10-01", "2026-12-31", "2025-12-31"]
  for (const day of days) await writeDay(bucket, "pages", day, [])
  for (const name of ["notes.txt", "2026-02-30.jsonl.gz", "nested/2026-01-01.jsonl.gz"]) {
    await bucket.put(`archive/pages/${name}`, "unrelated")
  }
  await writeDay(bucket, "pages-other", "2026-11-01", [])
  let pages = 0
  const paginated: ArchiveBucket = {
    put: (key, value) => bucket.put(key, value),
    get: (key) => bucket.get(key),
    list: async (options) => {
      pages++
      return bucket.list({ ...options, limit: 2 })
    },
  }
  expect(await listDays(paginated, "pages")).toEqual([...days].sort().reverse())
  expect(pages).toBeGreaterThan(1)
})

test("invalid keys and corrupt archives fail instead of returning partial rows", async () => {
  await expect(writeDay(bucket, "../room", "2026-10-01", [])).rejects.toThrow()
  await expect(writeDay(bucket, "valid", "2026-02-30", [])).rejects.toThrow()
  await expect(writeDay(bucket, "valid", "2026-10-01", [undefined])).rejects.toThrow()
  await bucket.put("archive/corrupt/2026-10-01.jsonl.gz", "not gzip")
  await expect(readDay(bucket, "corrupt", "2026-10-01")).rejects.toThrow()
})

test("5000 rich messages write and read through workerd R2 within 30 seconds", async () => {
  const rows = Array.from({ length: 5000 }, (_, seq) => row(seq))
  const started = performance.now()
  const result = await roundTrip("budget", rows)
  const elapsedMs = performance.now() - started
  expect(result).toEqual(rows)
  expect(elapsedMs).toBeLessThan(30_000)
  console.log(`archive 5000-message write/read wall time: ${elapsedMs.toFixed(1)} ms`)
}, 30_000)
