import type { LeaseInfo } from "../../integrations/kernel/lease"
import type { BrowserCheck } from "../../user/kernel-wiring"
import type { User } from "../../user/user-do"

export type Lease = LeaseInfo

export type BrowserState = BrowserCheck

type LiveLink = { ok: true; url: string; posted: boolean } | { ok: false; error: string }

export class BrowserNotConnected extends Error {
  constructor() {
    super("no browser: the human has not connected a Kernel key in settings")
    this.name = "BrowserNotConnected"
  }
}

export interface LeasePort {
  lease(): Promise<Lease>
  touch(tabs: Record<string, string>): Promise<boolean>
  dead(sessionId: string): Promise<boolean>
  state(): Promise<BrowserState>
  paused(): Promise<boolean>
  live(mode: "watch" | "control", reason?: string): Promise<LiveLink>
  handBack(): Promise<boolean>
}

export type UserBrowserRpc = Pick<
  User,
  | "browserLease"
  | "browserTouch"
  | "browserDead"
  | "browserCheck"
  | "browserTakeover"
  | "browserLive"
  | "browserHandBack"
>

const NOT_CONNECTED = /not connected/i
const PAUSE_MEMO_MS = 1_000

export function userLease(user: () => UserBrowserRpc, agentId: string, roomId: string): LeasePort {
  const connected = <T>(call: () => Promise<T>): Promise<T> =>
    call().catch((e: unknown) => {
      throw e instanceof Error && NOT_CONNECTED.test(e.message) ? new BrowserNotConnected() : e
    })
  let seen: { at: number; on: boolean } | undefined
  const paused = async (): Promise<boolean> => {
    const now = Date.now()
    if (seen && now - seen.at < PAUSE_MEMO_MS) return seen.on
    const on = await user().browserTakeover(agentId, roomId)
    seen = { at: now, on }
    return on
  }
  return {
    lease: () => connected(() => user().browserLease(agentId)),
    touch: (tabs) => user().browserTouch(agentId, tabs),
    dead: (sessionId) => user().browserDead(agentId, sessionId),
    state: () => user().browserCheck(agentId),
    paused: () => paused(),
    live: (mode, reason) => connected(() => user().browserLive(agentId, roomId, mode, reason)),
    handBack: async () => {
      seen = undefined
      return connected(() => user().browserHandBack(agentId))
    },
  }
}
