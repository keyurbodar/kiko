import type { ClockPort } from "@kiko/durable/clock-port"

export function agentStorage(storage: DurableObjectStorage, key: string, clock: ClockPort): DurableObjectStorage {
  const prefix = `agent:${key}:`
  const physical = (name: string) => prefix + name
  return new Proxy(storage, {
    get(target, property) {
      if (property === "get")
        return (name: string | string[]) =>
          Array.isArray(name)
            ? target
                .get(name.map(physical))
                .then((rows) => new Map([...rows].map(([name, value]) => [name.slice(prefix.length), value])))
            : target.get(physical(name))
      if (property === "put")
        return (name: string | Record<string, unknown>, value?: unknown) =>
          typeof name === "string"
            ? target.put(physical(name), value)
            : target.put(Object.fromEntries(Object.entries(name).map(([name, value]) => [physical(name), value])))
      if (property === "delete")
        return (name: string | string[]) =>
          Array.isArray(name) ? target.delete(name.map(physical)) : target.delete(physical(name))
      if (property === "list")
        return async (options: DurableObjectListOptions = {}) => {
          const rows = await target.list({
            ...options,
            prefix: physical(options.prefix ?? ""),
            ...(options.start ? { start: physical(options.start) } : {}),
            ...(options.startAfter ? { startAfter: physical(options.startAfter) } : {}),
            ...(options.end ? { end: physical(options.end) } : {}),
          })
          return new Map([...rows].map(([name, value]) => [name.slice(prefix.length), value]))
        }
      if (property === "getAlarm") return async () => clock.deadline("recovery") ?? null
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
