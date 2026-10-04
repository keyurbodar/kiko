const KEY = "decisions"

export const tools = {
  async log_decision({ decision, why }, kiko) {
    const all = (await kiko.state.get(KEY)) ?? []
    const day = new Date(kiko.now()).toISOString().slice(0, 10)
    all.push({ decision, why, day })
    await kiko.state.set(KEY, all.slice(-200))
    const body = all.map((d, i) => `${i + 1}. ${d.day}: ${d.decision} (because ${d.why})`).join("\n")
    await kiko.call("write_note", { title: "decisions", body })
    return `logged decision ${all.length}`
  },
}

export const sections = {
  async recent(kiko) {
    const all = (await kiko.state.get(KEY)) ?? []
    if (!all.length) return undefined
    const last = all.slice(-5).map((d) => `- ${d.day}: ${d.decision} (because ${d.why})`)
    return `the latest decisions in this chat, oldest first. call log_decision when a new one is made.\n${last.join("\n")}`
  },
}
