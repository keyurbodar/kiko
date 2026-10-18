export function getSetting(sql: SqlStorage, key: string): string | null {
  return sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", key).toArray()[0]?.value ?? null
}

/**
 * Stores a setting. Writing the value it already holds costs a row for nothing, and the free plan counts rows
 * written, so a no-op returns without touching the table. `ensureHome` runs on every request that signs in, and
 * it writes this way on each one: the guard is what keeps an idle account free.
 */
export function setSetting(sql: SqlStorage, key: string, value: string): void {
  sql.exec(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE value IS NOT excluded.value",
    key,
    value,
  )
}

export function deleteSetting(sql: SqlStorage, key: string): void {
  sql.exec("DELETE FROM settings WHERE key = ?", key)
}
