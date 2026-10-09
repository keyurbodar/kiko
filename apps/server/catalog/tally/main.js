const key = (name) => `count:${String(name).trim().toLowerCase()}`

export const tools = {
  async tally({ name, add, set }, yuki) {
    if (name && (add !== undefined || set !== undefined)) {
      const before = (await yuki.state.get(key(name))) ?? 0
      const after = set !== undefined ? set : before + add
      await yuki.state.set(key(name), after)
      return `${String(name).trim().toLowerCase()}: ${after}`
    }
    const keys = await yuki.state.list("count:")
    if (!keys.length) return "no counts yet"
    const lines = []
    for (const k of keys) lines.push(`${k.slice(6)}: ${await yuki.state.get(k)}`)
    return lines.join("\n")
  },
}
