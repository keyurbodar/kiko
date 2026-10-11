// What an agent asks of UserDO about the user's one Kernel browser (architecture section 27). This
// file is the only place that names the RPC methods.

export type Lease = { sessionId: string; cdpUrl: string; mode: "headless" | "headful"; restarted: boolean; reopen: string[] }

export type BrowserState = { connected: boolean; takeover: boolean; tabs: Record<string, number> }

/** The user has no Kernel key. The tools say so instead of failing. */
export class BrowserNotConnected extends Error {
  constructor() {
    super("no browser: the human has not connected a Kernel key in settings")
    this.name = "BrowserNotConnected"
  }
}

export interface LeasePort {
  lease(): Promise<Lease>
  /** Stamps last use and reports this agent's open tabs, tab id to last URL. */
  touch(tabs: Record<string, string>): Promise<boolean>
  /** The socket to `sessionId` closed. UserDO marks the browser dead only if Kernel says it is gone. */
  dead(sessionId: string): Promise<boolean>
  release(): Promise<void>
  /** Whether a key is stored, and each agent's open tab count. */
  state(): Promise<BrowserState>
  /** The human pressed Take over. Every browser tool and worker step waits for Hand back. */
  paused(): Promise<boolean>
  /** Asks the human to watch or take over. Returns what to tell the model. */
  share(reason: string): Promise<string>
}

export type UserBrowserRpc = {
  browserLease(agentId: string): Promise<Lease>
  browserTouch(agentId: string, tabs?: Record<string, string>): Promise<boolean>
  browserDead(agentId: string, sessionId: string): Promise<boolean>
  browserRelease(agentId: string): Promise<void>
  browserCheck(): Promise<BrowserState>
  browserTakeover(): Promise<boolean>
  browserShare(agentId: string, roomId: string, reason: string): Promise<boolean>
}

const NOT_CONNECTED = /not connected/i

export function userLease(user: () => UserBrowserRpc, agentId: string, roomId: string): LeasePort {
  return {
    lease: () =>
      user()
        .browserLease(agentId)
        .catch((e: unknown) => {
          throw e instanceof Error && NOT_CONNECTED.test(e.message) ? new BrowserNotConnected() : e
        }),
    touch: (tabs) => user().browserTouch(agentId, tabs),
    dead: (sessionId) => user().browserDead(agentId, sessionId),
    release: () => user().browserRelease(agentId),
    state: () => user().browserCheck(),
    paused: () => user().browserTakeover(),
    share: async (reason) =>
      (await user().browserShare(agentId, roomId, reason)) ? "Asked the human to watch or take over the browser." : "Could not post the request to the human.",
  }
}
