// The `settings` key-value table in UserDO storage.

export function getSetting(sql: SqlStorage, key: string): string | null {
  return sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", key).toArray()[0]?.value ?? null
}

export function setSetting(sql: SqlStorage, key: string, value: string): void {
  sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value)
}

export function deleteSetting(sql: SqlStorage, key: string): void {
  sql.exec("DELETE FROM settings WHERE key = ?", key)
}
