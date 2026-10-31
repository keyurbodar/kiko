import type { TerminalSummary } from "@kiko/protocol"
import { owner, run } from "../../state/runtime"

export async function listTerminals(pcId: string): Promise<readonly TerminalSummary[]> {
  const result = await run(owner.commands.terminalList, { pcId })
  return result._tag === "Success" ? result.value : []
}

export async function openTerminal(pcId: string, cols: number, rows: number): Promise<TerminalSummary | null> {
  const result = await run(owner.commands.terminalOpen, { pcId, cols, rows })
  return result._tag === "Success" ? result.value : null
}
