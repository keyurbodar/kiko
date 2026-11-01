type AgentFacts = {
  model?: string
  tools?: number
  memory?: boolean
}

export function agentMetaLine(facts: AgentFacts): string | undefined {
  const parts = [
    facts.model,
    facts.tools === undefined ? undefined : `${facts.tools} ${facts.tools === 1 ? "tool" : "tools"}`,
    facts.memory === undefined ? undefined : facts.memory ? "Memory on" : "Memory off",
  ].filter((part): part is string => Boolean(part))
  return parts.length ? parts.join(" · ") : undefined
}
