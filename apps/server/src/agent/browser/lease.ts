import type { CurlRequest, CurlResponse } from "../../integrations/kernel/client"
import type { LeaseInfo } from "../../integrations/kernel/lease"
import type { BrowserCheck } from "../../user/kernel-wiring"
import type { UserDO } from "../../user/user-do"

export type Lease = LeaseInfo

export type BrowserState = BrowserCheck

export type LiveLink = { ok: true; url: string; posted: boolean } | { ok: false; error: string }

export type FetchRequest = CurlRequest

export type FetchResult = CurlResponse

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
  /** The live view link. With a reason it is also posted to the room as the agent. `control` pauses every agent's browser tools. */
  live(mode: "watch" | "control", reason?: string): Promise<LiveLink>
  /** Ends the human's control. False when the agents already had it. */
  handBack(): Promise<boolean>
  /** HTTP through the browser's network stack, with its cookies and proxy. Only http and https. */
  fetchPage(req: FetchRequest): Promise<FetchResult>
  /** Writes an upload into the browser's VM. Returns the VM path to use in an upload step. */
  putFile(name: string, base64: string): Promise<{ path: string }>
  /** Reads a file from the browser's VM, under /tmp or the downloads folder. */
  getFile(path: string): Promise<{ name: string; base64: string; size: number }>
  /** Names of the files in a folder on the browser's VM, under /tmp or the downloads folder. */
  listFiles(dir: string): Promise<string[]>
}

/** The user's RPC surface, read from `UserDO` so each signature is declared once. */
export type UserBrowserRpc = Pick<
  UserDO,
  | "browserLease"
  | "browserTouch"
  | "browserDead"
  | "browserCheck"
  | "browserTakeover"
  | "browserLive"
  | "browserHandBack"
  | "browserFetch"
  | "browserPutFile"
  | "browserGetFile"
  | "browserListFiles"
>

const NOT_CONNECTED = /not connected/i
const PAUSE_MEMO_MS = 1_000

export function userLease(user: () => UserBrowserRpc, agentId: string, roomId: string): LeasePort {
  const connected = <T>(call: () => Promise<T>): Promise<T> =>
    call().catch((e: unknown) => {
      throw e instanceof Error && NOT_CONNECTED.test(e.message) ? new BrowserNotConnected() : e
    })
  let seen: { at: number; on: boolean } | undefined
  /** A step loop asks per step. The answer is reused for a second, so ten steps cost one call; a takeover waits at most that long. */
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
    fetchPage: (req) => connected(() => user().browserFetch(req)),
    putFile: (name, base64) => connected(() => user().browserPutFile(name, base64)),
    getFile: (path) => connected(() => user().browserGetFile(path)),
    listFiles: (dir) => connected(() => user().browserListFiles(dir)),
  }
}
