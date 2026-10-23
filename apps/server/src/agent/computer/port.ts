import type { Op } from "@kiko/computer/wire"
import type { Holder } from "@kiko/computer/wire"
import type { User } from "../../user/user-do"
import type { ComputerCallOutcome, ComputerLinkOutcome, ComputerMode, ComputerSummary } from "./types"

export type UserComputerRpc = Pick<User, "computerList" | "computerCall" | "computerLink" | "computerHolder">

export interface ComputerPort {
  list(): Promise<ComputerSummary[]>
  resolve(pc?: string): Promise<ComputerSummary>
  call(pcId: string, op: Op, args: unknown, deadlineMs: number): Promise<ComputerCallOutcome>
  link(pcId: string, mode: ComputerMode, reason?: string): Promise<ComputerLinkOutcome>
  holder(pcId: string): Promise<Holder>
}

class NoComputer extends Error {
  constructor() {
    super("no computer is paired with kiko: the human pairs one in settings, computers")
    this.name = "NoComputer"
  }
}

const names = (all: readonly ComputerSummary[]): string =>
  all.map((pc) => `${pc.name} (${pc.os}${pc.online ? "" : ", offline"})`).join(", ")

export function userComputer(user: () => UserComputerRpc, agentId: string, roomId: string): ComputerPort {
  const resolve = async (which?: string): Promise<ComputerSummary> => {
    const all = await user().computerList()
    const first = all[0]
    if (!first) throw new NoComputer()
    const want = which?.trim()
    if (!want) {
      if (all.length === 1) return first
      throw new Error(`there are ${all.length} computers: ${names(all)}. name the one you mean with pc.`)
    }
    const lower = want.toLowerCase()
    const found = all.find((pc) => pc.id === want) ?? all.find((pc) => pc.name.toLowerCase() === lower)
    if (found) return found
    throw new Error(`there is no computer called ${want}. the computers are: ${names(all)}.`)
  }
  return {
    list: async () => user().computerList(),
    resolve,
    call: (pcId, op, args, deadlineMs) => user().computerCall(agentId, roomId, pcId, op, args, deadlineMs),
    link: (pcId, mode, reason) => user().computerLink(agentId, roomId, pcId, mode, reason),
    holder: async (pcId) => user().computerHolder(pcId),
  }
}
