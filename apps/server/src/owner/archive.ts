export type ArchiveBucket = {
  put(key: string, value: Uint8Array): Promise<unknown>
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: readonly { key: string }[]
    truncated: boolean
    cursor?: string
  }>
}

const ROOT = "archive/"
const SUFFIX = ".jsonl.gz"

function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const at = Date.parse(`${day}T00:00:00.000Z`)
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === day
}

function roomPrefix(roomId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) throw new Error("Invalid archive room id")
  return `${ROOT}${roomId}/`
}

function dayKey(roomId: string, day: string): string {
  if (!validDay(day)) throw new Error("Invalid archive UTC day")
  return `${roomPrefix(roomId)}${day}${SUFFIX}`
}

/** Rows must be JSON serializable. Rewriting a day replaces its entire snapshot. */
export async function writeDay(bucket: ArchiveBucket, roomId: string, day: string, rows: readonly unknown[]): Promise<void> {
  const key = dayKey(roomId, day)
  const jsonl = rows.map((row) => {
    const json = JSON.stringify(row)
    if (json === undefined) throw new Error("Archive row is not JSON serializable")
    return `${json}\n`
  }).join("")
  const stream = new Blob([jsonl]).stream().pipeThrough(new CompressionStream("gzip"))
  await bucket.put(key, new Uint8Array(await new Response(stream).arrayBuffer()))
}

/** T describes the caller's stored JSON schema; this module does not validate row fields. */
export async function readDay<T>(bucket: ArchiveBucket, roomId: string, day: string): Promise<T[] | null> {
  const object = await bucket.get(dayKey(roomId, day))
  if (!object) return null
  const stream = new Blob([await object.arrayBuffer()]).stream().pipeThrough(new DecompressionStream("gzip"))
  const jsonl = await new Response(stream).text()
  const lines = jsonl.split("\n")
  if (lines.at(-1) === "") lines.pop()
  return lines.map((line) => JSON.parse(line))
}

/** Read every R2 list page and return UTC days newest first. */
export async function listDays(bucket: ArchiveBucket, roomId: string): Promise<string[]> {
  const prefix = roomPrefix(roomId)
  const days = new Set<string>()
  let cursor: string | undefined
  for (;;) {
    const page = await bucket.list(cursor === undefined ? { prefix } : { prefix, cursor })
    for (const object of page.objects) {
      if (!object.key.startsWith(prefix) || !object.key.endsWith(SUFFIX)) continue
      const day = object.key.slice(prefix.length, -SUFFIX.length)
      if (validDay(day)) days.add(day)
    }
    if (!page.truncated) return [...days].sort().reverse()
    if (page.cursor === undefined || page.cursor === cursor) throw new Error("Archive list cursor did not advance")
    cursor = page.cursor
  }
}
