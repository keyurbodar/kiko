const KEY = "protected"
// The file tools and the arguments that hold a path they change.
const CHANGES = {
  write: (a) => [a.path],
  edit: (a) => [a.path],
  mkdir: (a) => [a.path],
  rm: (a) => a.paths ?? [],
  mv: (a) => [a.from, a.to],
  cp: (a) => [a.to],
}

const clean = (p) => ("/" + String(p ?? "").trim()).replace(/\/+/g, "/").replace(/\/$/, "") || "/"
const inside = (path, folder) => folder === "/" || path === folder || path.startsWith(folder + "/")

export const tools = {
  async guard_paths({ add, remove }, yuki) {
    let folders = (await yuki.state.get(KEY)) ?? []
    if (add) folders = [...new Set([...folders, clean(add)])].sort()
    if (remove) folders = folders.filter((f) => f !== clean(remove))
    if (add || remove) await yuki.state.set(KEY, folders)
    return folders.length ? `protected: ${folders.join(", ")}` : "nothing is protected"
  },
}

export const hooks = {
  async beforeTool(call, yuki) {
    const paths = CHANGES[call.name]?.(call.arguments ?? {})
    if (!paths?.length) return
    const folders = (await yuki.state.get(KEY)) ?? []
    const hit = paths.map(clean).find((p) => folders.some((f) => inside(p, f)))
    if (hit) return { block: `${hit} is in a protected folder; ask the human first` }
  },
}
