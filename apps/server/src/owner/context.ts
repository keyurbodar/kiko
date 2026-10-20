export function scopePrefix(name: string): string {
  return `s${Array.from(new TextEncoder().encode(name), (byte) => byte.toString(16).padStart(2, "0")).join("")}_`
}

/** Preserves scoped schemas in one SQLite database until PR4 gives them shared tables. */
export function scopedContext(
  owner: DurableObjectState,
  name: string,
  sockets: () => WebSocket[],
  refreshClock?: () => Promise<void>,
): DurableObjectState {
  const prefix = scopePrefix(name)
  const virtualTables = new Set<string>()
  const names = new Set(["meta"])
  const physical = (value: string) => `${prefix}${value}`
  for (const row of owner.storage.sql.exec<{ name: string; sql: string | null }>("SELECT name, sql FROM sqlite_master WHERE substr(name, 1, ?) = ?", prefix.length, prefix)) {
    names.add(row.name.slice(prefix.length))
    if (/^CREATE VIRTUAL TABLE/i.test(row.sql ?? "")) virtualTables.add(row.name.slice(prefix.length))
  }
  function rewrite(query: string): string {
    for (const match of query.matchAll(/\bCREATE\s+(?:UNIQUE\s+|VIRTUAL\s+)?(?:TABLE|INDEX|TRIGGER|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][A-Za-z_0-9]*)/gi)) names.add(match[1]!)
    const tokens = [...query.matchAll(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g)]
      .filter((match) => !match[0].startsWith("--") && !match[0].startsWith("/*"))
    const replacements = new Map<number, string>()
    const value = (index: number) => (tokens[index]?.[0] ?? "").replace(/^["`]|["`]$/g, "")
    const upper = (index: number) => value(index).toUpperCase()
    const replace = (index: number) => {
      const token = tokens[index]
      if (!token || token[0].startsWith("'")) return
      const name = value(index)
      if (name === "sqlite_master" || name === "sqlite_schema") {
        replacements.set(index, `(SELECT type, substr(name, ${prefix.length + 1}) AS name, substr(tbl_name, ${prefix.length + 1}) AS tbl_name, rootpage, replace(sql, '${prefix}', '') AS sql FROM sqlite_master WHERE substr(name, 1, ${prefix.length}) = '${prefix}')`)
        return
      }
      if (names.has(name)) replacements.set(index, `"${physical(name)}"`)
    }
    const referenced = new Set<string>()
    const aliases = new Set<string>()
    const virtual = /CREATE\s+VIRTUAL\s+TABLE/i.test(query)
    let creatingIndexOrTrigger = false
    for (let i = 0; i < tokens.length; i++) {
      const word = upper(i)
      if (["TABLE", "INDEX", "TRIGGER", "VIEW"].includes(word) && ["CREATE", "VIRTUAL", "UNIQUE", "DROP", "ALTER"].includes(upper(i - 1))) {
        let next = i + 1
        if (upper(next) === "IF") next += upper(next + 1) === "NOT" ? 3 : 2
        replace(next)
        if (virtual && word === "TABLE") virtualTables.add(value(next))
        if (word === "INDEX" || word === "TRIGGER") creatingIndexOrTrigger = true
      }
      if (["FROM", "JOIN", "INTO", "UPDATE", "REFERENCES"].includes(word) && value(i + 1) !== "(" && !["DO", "AFTER", "BEFORE", "OF"].includes(upper(i - 1))) {
        let next = i + 1
        if (word === "UPDATE" && upper(next) === "OR") next += 2
        replace(next)
        referenced.add(value(next))
        if (upper(next + 1) === "AS") aliases.add(value(next + 2))
      }
      if (word === "ON" && creatingIndexOrTrigger) { replace(i + 1); creatingIndexOrTrigger = false }
      if (word === "RENAME" && upper(i + 1) === "TO") replace(i + 2)
      if (["TABLE_INFO", "TABLE_XINFO", "INDEX_LIST", "FOREIGN_KEY_LIST"].includes(word) && value(i + 1) === "(") replace(i + 2)
      if (virtual && word === "CONTENT" && value(i + 1) === "=") {
        const raw = tokens[i + 2]?.[0]
        if (raw?.startsWith("'")) replacements.set(i + 2, `'${physical(raw.slice(1, -1))}'`)
      }
    }
    for (let i = 0; i < tokens.length; i++) {
      const name = value(i)
      if (!referenced.has(name) || aliases.has(name)) continue
      if (value(i + 1) === "." || upper(i + 1) === "MATCH" || (["BM25", "HIGHLIGHT", "SNIPPET"].includes(upper(i - 2)) && value(i - 1) === "(")) replace(i)
      // FTS5's hidden control column has the same name as its virtual table.
      if (virtualTables.has(name) && value(i - 1) === "(" && upper(i - 3) === "INTO" && value(i - 2) === name) replace(i)
    }
    let result = ""
    let end = 0
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!
      result += query.slice(end, token.index) + (replacements.get(i) ?? token[0])
      end = token.index! + token[0].length
    }
    return result + query.slice(end)
  }
  const sql = new Proxy(owner.storage.sql, {
    get(target, property) {
      if (property === "exec") return (query: string, ...bindings: unknown[]) => target.exec(rewrite(query), ...bindings)
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  async function arm(): Promise<void> {
    if (refreshClock) return refreshClock()
    const at = owner.storage.sql.exec<{ at: number | null }>("SELECT min(at) AS at FROM owner_deadlines").one().at
    const current = await owner.storage.getAlarm()
    if (current === at) return
    if (at === null) await owner.storage.deleteAlarm()
    else await owner.storage.setAlarm(at)
  }
  const storage = new Proxy(owner.storage, {
    get(target, property) {
      if (property === "sql") return sql
      if (property === "getAlarm") return async () => owner.storage.sql.exec<{ at: number }>("SELECT at FROM owner_deadlines WHERE scope = ?", name).toArray()[0]?.at ?? null
      if (property === "setAlarm") return async (at: number | Date) => {
        owner.storage.sql.exec("INSERT INTO owner_deadlines (scope, at) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET at = excluded.at WHERE at != excluded.at", name, +at)
        await arm()
      }
      if (property === "deleteAlarm") return async () => {
        owner.storage.sql.exec("DELETE FROM owner_deadlines WHERE scope = ?", name)
        await arm()
      }
      if (property === "get") return (key: string | string[]) => Array.isArray(key)
        ? target.get(key.map(physical)).then((values) => new Map([...values].map(([key, value]) => [key.slice(prefix.length), value])))
        : target.get(physical(key))
      if (property === "put") return (key: string | Record<string, unknown>, value?: unknown) => typeof key === "string"
        ? target.put(physical(key), value)
        : target.put(Object.fromEntries(Object.entries(key).map(([key, value]) => [physical(key), value])))
      if (property === "delete") return (key: string | string[]) => Array.isArray(key) ? target.delete(key.map(physical)) : target.delete(physical(key))
      if (property === "list") return async (options: DurableObjectListOptions = {}) => {
        const values = await target.list({ ...options, prefix: physical(options.prefix ?? ""), ...(options.start ? { start: physical(options.start) } : {}), ...(options.end ? { end: physical(options.end) } : {}) })
        return new Map([...values].map(([key, value]) => [key.slice(prefix.length), value]))
      }
      if (property === "transaction") return (callback: (transaction: DurableObjectStorage) => Promise<unknown>) => target.transaction(() => callback(storage))
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return new Proxy(owner, {
    get(target, property) {
      if (property === "storage") return storage
      if (property === "id") return { name, toString: () => owner.id.toString(), equals: owner.id.equals.bind(owner.id) }
      if (property === "getWebSockets") return sockets
      if (property === "setWebSocketAutoResponse") return () => {}
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
