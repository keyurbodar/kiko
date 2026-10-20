export function erase(storage: DurableObjectStorage): void {
  storage.transactionSync(() => {
    const tables = storage.sql.exec<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL").toArray()
    const virtual = tables.filter((t) => t.sql.startsWith("CREATE VIRTUAL TABLE")).map((t) => t.name)
    const roots = tables.filter((t) => virtual.includes(t.name))
    for (const { name, sql } of roots) if (!/\bcontent\s*=/i.test(sql)) storage.sql.exec(`DELETE FROM "${name.replaceAll('"', '""')}"`)
    for (const { name } of tables) {
      if (name === "meta" || name.startsWith("sqlite_") || name.startsWith("_cf_") || virtual.some((v) => name === v || name.startsWith(`${v}_`))) continue
      storage.sql.exec(`DELETE FROM "${name.replaceAll('"', '""')}"`)
    }
    for (const { name, sql } of roots) if (/\bcontent\s*=/i.test(sql)) {
      const quoted = `"${name.replaceAll('"', '""')}"`
      storage.sql.exec(`INSERT INTO ${quoted} (${quoted}) VALUES ('delete-all')`)
    }
    storage.sql.exec("DELETE FROM meta WHERE key != 'schema_version'")
    storage.sql.exec("INSERT INTO meta (key, value) VALUES ('deleted', '1')")
  })
}
