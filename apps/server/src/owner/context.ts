import type { Metadata } from "./services"

export function metadata(storage: DurableObjectStorage, scope: string): Metadata {
  const sql = storage.sql
  return {
    get: (key) => sql.exec<{ value: string }>("SELECT value FROM owner_meta WHERE scope = ? AND key = ?", scope, key).toArray()[0]?.value ?? null,
    set: (key, value) => { sql.exec("INSERT INTO owner_meta (scope, key, value) VALUES (?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value WHERE value IS NOT excluded.value", scope, key, value) },
    delete: (key) => { sql.exec("DELETE FROM owner_meta WHERE scope = ? AND key = ?", scope, key) },
  }
}

export function serviceContext(owner: DurableObjectState, sockets: () => WebSocket[]): DurableObjectState {
  return new Proxy(owner, {
    get(target, property) {
      if (property === "getWebSockets") return sockets
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
