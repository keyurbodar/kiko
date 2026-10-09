const KEY = "decisions"

export const tools = {
  async log_decision({ decision, why }, yuki) {
    const all = (await yuki.state.get(KEY)) ?? []
    const day = new Date(yuki.now()).toISOString().slice(0, 10)
    all.push({ decision, why, day })
    await yuki.state.set(KEY, all.slice(-200))
    const body = all.map((d, i) => `${i + 1}. ${d.day}: ${d.decision} (because ${d.why})`).join("\n")
    await yuki.call("write", { path: "/decisions.md", content: `# decisions\n\n${body}\n` })
    return `logged decision ${all.length}`
  },
}

export const sections = {
  async recent(yuki) {
    const all = (await yuki.state.get(KEY)) ?? []
    if (!all.length) return undefined
    const last = all.slice(-5).map((d) => `- ${d.day}: ${d.decision} (because ${d.why})`)
    return `the latest decisions in this chat, oldest first. call log_decision when a new one is made.\n${last.join("\n")}`
  },
}
