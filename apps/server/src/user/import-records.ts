import type { Life } from "@yuki/memory/life"
import { capBytes, LINE_BYTES, oneLine } from "@yuki/memory/optmem"

export function importRecords(sql: SqlStorage, life: Life): number {
  const has = sql.exec("SELECT 1 FROM sqlite_master WHERE name = 'memory_records'").toArray().length > 0
  if (!has) return 0
  const records = sql.exec<{ id: string; title: string; body: string; updated_at: number }>("SELECT id, title, body, updated_at FROM memory_records WHERE archived = 0").toArray()
  const lines: { at: number; text: string }[] = []
  for (const r of records) {
    for (const raw of r.body.split("\n")) {
      const line = raw.trim().replace(/^[-*]\s*/, "")
      if (!line) continue
      const dated = /^(\d{4}-\d{2}-\d{2}):\s*(.*?)(?:\s+\([^)]*\))?$/.exec(line)
      const at = dated ? Date.parse(`${dated[1]}T12:00:00Z`) : r.updated_at
      const text = dated ? (dated[2] ?? "") : line
      const named = ["profile", "now", "todo"].includes(r.id) ? text : `${r.title}: ${text}`
      lines.push({ at: Number.isFinite(at) ? at : r.updated_at, text: capBytes(oneLine(named, 1_000), LINE_BYTES) })
    }
  }
  lines.sort((a, b) => a.at - b.at)
  let n = 0
  for (const l of lines) if (life.append(l.text, "", l.at).ok) n++
  for (const table of ["memory_records", "memory_versions", "memory_fts"]) sql.exec(`DROP TABLE IF EXISTS ${table}`)
  return n
}
