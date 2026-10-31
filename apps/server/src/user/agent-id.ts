export function slugOf(agentId: string): string {
  return agentId.split(/[/:]/).pop() ?? agentId
}
