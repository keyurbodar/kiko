import * as Schema from "effect/Schema"
import type { DesktopTool } from "@kiko/computer/driver"
import type { Op } from "@kiko/computer/wire"
import type { User } from "../../user/user-do"
import type { ComputerCallOutcome, ComputerLinkOutcome, ComputerMode, ComputerSummary } from "./types"

export type UserComputerRpc = Pick<User, "computerList" | "computerCall" | "computerLink" | "computerDesktop">

export interface ComputerPort {
  list(): Promise<ComputerSummary[]>
  resolve(pc?: string): Promise<ComputerSummary>
  desktopTools(): Promise<readonly DesktopTool[]>
  call(pcId: string, op: Op, args: unknown, deadlineMs: number): Promise<ComputerCallOutcome>
  link(pcId: string, mode: ComputerMode, reason?: string): Promise<ComputerLinkOutcome>
}

class NoComputer extends Schema.TaggedError<NoComputer>()("NoComputer", {
  reason: Schema.Literals(["none_paired", "ambiguous", "unknown"]),
  message: Schema.String,
}) {}

const names = (all: readonly ComputerSummary[]): string =>
  all.map((pc) => `${pc.name} (${pc.os}${pc.online ? "" : ", offline"})`).join(", ")

export function userComputer(user: () => UserComputerRpc, agentId: string, roomId: string): ComputerPort {
  const resolve = async (which?: string): Promise<ComputerSummary> => {
    const all = await user().computerList()
    const first = all[0]
    if (!first)
      throw new NoComputer({
        reason: "none_paired",
        message: "no computer is paired with kiko: the human pairs one in settings, computers",
      })
    const want = which?.trim()
    if (!want) {
      if (all.length === 1) return first
      throw new NoComputer({
        reason: "ambiguous",
        message: `there are ${all.length} computers: ${names(all)}. name the one you mean with pc.`,
      })
    }
    const lower = want.toLowerCase()
    const byId = all.find((pc) => pc.id === want)
    if (byId) return byId
    const named = all.filter((pc) => pc.name.toLowerCase() === lower)
    if (named.length === 1 && named[0]) return named[0]
    if (named.length > 1)
      throw new NoComputer({
        reason: "ambiguous",
        message: `${named.length} computers are called ${want}: ${named.map((pc) => `${pc.name} (${pc.id})`).join(", ")}. pass the id of the one you mean in pc.`,
      })
    throw new NoComputer({
      reason: "unknown",
      message: `there is no computer called ${want}. the computers are: ${names(all)}.`,
    })
  }
  return {
    list: async () => user().computerList(),
    desktopTools: async () => user().computerDesktop()?.tools ?? [],
    resolve,
    call: (pcId, op, args, deadlineMs) => user().computerCall(agentId, roomId, pcId, op, args, deadlineMs),
    link: (pcId, mode, reason) => user().computerLink(agentId, roomId, pcId, mode, reason),
  }
}
