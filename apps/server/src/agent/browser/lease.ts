import type { CurlRequest, CurlResponse } from "../../integrations/kernel/client"
import type { LeaseInfo } from "../../integrations/kernel/lease"
import type { UserDO } from "../../user/user-do"

export type Lease = LeaseInfo

export type BrowserState = { connected: boolean; takeover: boolean; tabs: Record<string, number> }

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
  release(): Promise<void>
  state(): Promise<BrowserState>
  paused(): Promise<boolean>
  share(reason: string): Promise<string>
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
  | "browserRelease"
  | "browserCheck"
  | "browserTakeover"
  | "browserShare"
  | "browserFetch"
  | "browserPutFile"
  | "browserGetFile"
  | "browserListFiles"
>

const NOT_CONNECTED = /not connected/i

export function userLease(user: () => UserBrowserRpc, agentId: string, roomId: string): LeasePort {
  const connected = <T>(call: () => Promise<T>): Promise<T> =>
    call().catch((e: unknown) => {
      throw e instanceof Error && NOT_CONNECTED.test(e.message) ? new BrowserNotConnected() : e
    })
  return {
    lease: () => connected(() => user().browserLease(agentId)),
    touch: (tabs) => user().browserTouch(agentId, tabs),
    dead: (sessionId) => user().browserDead(agentId, sessionId),
    release: () => user().browserRelease(agentId),
    state: () => user().browserCheck(),
    paused: () => user().browserTakeover(),
    share: async (reason) =>
      (await user().browserShare(agentId, roomId, reason)) ? "Asked the human to watch or take over the browser." : "Could not post the request to the human.",
    fetchPage: (req) => connected(() => user().browserFetch(req)),
    putFile: (name, base64) => connected(() => user().browserPutFile(name, base64)),
    getFile: (path) => connected(() => user().browserGetFile(path)),
    listFiles: (dir) => connected(() => user().browserListFiles(dir)),
  }
}
