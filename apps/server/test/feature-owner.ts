import { OwnerDO } from "../src/owner/owner-do"
import type { Agent } from "../src/agent/agent-do"
import type { Env } from "../src/index"
import type { Envelope, RoomId } from "@kiko/protocol"

type AgentTrace = { got: Envelope[]; stops: number; answers: string[]; waiting: boolean }

export class FeatureOwner extends OwnerDO {
  private readonly agentsSeen = new WeakSet<Agent>()
  private readonly traces = new Map<string, AgentTrace>()
  private readonly touches: { roomId: string; lastPreview: string; unread: number; mentions?: number }[] = []
  private readonly errors: { error: unknown; roomId: string }[] = []
  private readonly problems: string[][] = []
  private readonly typing: { roomId: string; names: string[] }[] = []
  private readonly opened: { title: string; agents: string[] }[] = []
  private readonly chiefRooms = new Set<string>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const user = this.user()
    const changed = user.roomChanged.bind(user)
    user.roomChanged = (roomId) => { this.touches.push({ roomId, ...this.room(roomId).activity() }); changed(roomId) }
    const typing = user.chatTyping.bind(user)
    user.chatTyping = async (roomId, names) => { this.typing.push({ roomId, names: [...names] }); await typing(roomId, names) }
    const error = user.notifyError.bind(user)
    user.notifyError = async (body, roomId) => { this.errors.push({ error: body, roomId }); await error(body, roomId) }
    const problem = user.recordProviderProblem.bind(user)
    user.recordProviderProblem = async (provider, kind) => { this.problems.push([provider, kind]); await problem(provider, kind) }
    const open = user.openChat.bind(user)
    user.openChat = async (...args) => {
      const result = await open(...args)
      if (result.created) this.opened.push({ title: args[0], agents: [...args[1]] })
      return result
    }
    const getChat = user.getChat.bind(user)
    user.getChat = async (roomId) => {
      const chat = await getChat(roomId)
      return chat && this.chiefRooms.has(roomId) ? { ...chat, kiko: true, agents: ["kiko"] } : chat
    }
    ctx.blockConcurrencyWhile(async () => {
      for (const [slug, name] of [["ada", "Ada"], ["bo", "Bo"], ["di", "Di"], ["scout", "Scout"]]) await user.makeAgent({ id: `a-${slug}`, slug: slug!, name: name!, description: `${name} writes`, soul: `# ${name}\n`, model: "" })
    })
  }

  private trace(roomId: string, slug: string): AgentTrace {
    const key = `${roomId}:${slug}`
    let trace = this.traces.get(key)
    if (!trace) { trace = { got: [], stops: 0, answers: [], waiting: false }; this.traces.set(key, trace) }
    return trace
  }

  protected override agent(roomId: string, slug: string): Agent {
    const agent = super.agent(roomId, slug)
    if (this.agentsSeen.has(agent)) return agent
    this.agentsSeen.add(agent)
    const trace = this.trace(roomId, slug)
    agent.receive = async (envelopes) => { trace.got.push(...envelopes); return { admitted: envelopes.map((envelope) => envelope.id) } }
    agent.stop = async () => { trace.stops++; return { discarded: 0 } }
    agent.askAnswered = async (id, text) => { trace.answers.push(`${id}=${text}`); return trace.waiting }
    agent.humanComing = async () => {}
    agent.humanGone = async () => {}
    agent.wake = async () => false
    return agent
  }

  async observations(kind: string, roomId?: string, slug?: string) {
    if (kind === "touches") return this.touches.filter((touch) => touch.roomId === roomId)
    if (kind === "errors") return this.errors
    if (kind === "problems") return this.problems
    if (kind === "typing") return this.typing.filter((entry) => entry.roomId === roomId).map((entry) => entry.names)
    if (kind === "opened") return this.opened
    if (kind === "saved") return this.room(roomId!).memberSlugs()
    if (kind === "agent") { const trace = this.trace(roomId!, slug!); return { got: trace.got, stops: trace.stops } }
    if (kind === "answers") return this.trace(roomId!, slug!).answers
    return null
  }
  async agentWaiting(roomId: string, slug: string, waiting: boolean) { this.trace(roomId, slug).waiting = waiting }
  async markKiko(roomId: RoomId) {
    this.chiefRooms.add(roomId)
    const chat = await this.user().createChat(roomId, "Kiko")
    this.room(roomId).saveChat({ ...chat, kiko: true, agents: ["kiko"] })
  }
}
