import "../index.css"
import type { RunStep } from "@kiko/protocol"
import { describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "../../test/render"
import type { ChatMessage, RosterBot } from "../lib/types"
import { VirtualThread } from "./VirtualThread"

const ROOM = "01900000-0000-7000-8000-0000000000dd"
const START = Date.UTC(2026, 9, 30, 9)

const fake = vi.hoisted(() => ({
  ready: false,
  steps: {} as Record<string, RunStep[]>,
  asked: [] as string[],
  deliver: ((_key: string) => []) as (key: string) => RunStep[],
}))

vi.mock("../state/room", async () => {
  const { createSignal } = await import("solid-js")
  const [ready, setReady] = createSignal(fake.ready)
  const [steps, setSteps] = createSignal<Record<string, RunStep[]>>(fake.steps)
  Object.defineProperty(fake, "ready", { get: ready, set: setReady })
  Object.defineProperty(fake, "steps", { get: steps, set: setSteps })
  const asked = new Set<string>()
  return {
    fileSrc: () => "",
    room: {
      runSteps: (key: string) => steps()[key] ?? [],
      carriesRun: () => false,
      runWindow: (m: ChatMessage) => (m.botId && m.steps ? `${m.botId}#${m.stepAfter ?? 0}` : undefined),
      runReady: () => ready(),
      runLive: () => false,
      runFetching: () => false,
      loadRunSteps: (key: string) => {
        if (!ready() || asked.has(key)) return
        asked.add(key)
        setSteps((all) => ({ ...all, [key]: fake.deliver(key) }))
      },
      runEnd: () => undefined,
      thoughtFor: () => undefined,
      thoughtOfRun: () => undefined,
      loadThoughts: () => {},
      activeId: () => ROOM,
      helpers: () => [],
      roomMembers: () => [],
    },
  }
})

vi.mock("./side/surfaces", () => ({
  fixedSurface: () => ({}),
  openFile: () => {},
  openSurface: () => {},
  deskView: () => null,
  helperSurface: () => ({}),
}))

vi.mock("./ui/find-file", () => ({ findFile: () => null }))

const bot: RosterBot = {
  id: "kiko",
  name: "Kiko",
  preview: "",
  updatedAt: 0,
  presence: "idle",
  unread: 0,
  pinned: false,
}

const owner: ChatMessage = {
  id: "1.room",
  threadId: ROOM,
  sender: "user",
  body: "[think] [work] [steps 3] compare hotels",
  sentAt: START,
  seq: 1,
}

const activity: ChatMessage = {
  id: "2.room",
  threadId: ROOM,
  sender: "bot",
  botId: "kiko",
  body: "",
  sentAt: START + 900,
  seq: 2,
  steps: 1,
  stepAfter: 0,
  event: { kind: "activity", agent: "kiko" as never, private: true },
}

const reply: ChatMessage = {
  id: "3.room",
  threadId: ROOM,
  sender: "bot",
  botId: "kiko",
  body: "report w1 done",
  sentAt: START + 10_000,
  seq: 3,
  steps: 3,
  stepAfter: 2,
}

function step(id: string, more: Partial<RunStep>): RunStep {
  return {
    id,
    runId: "run",
    slug: "kiko",
    tool: "run",
    name: "bash",
    label: `Ran ${id}`,
    status: "done",
    startedAt: START,
    endedAt: START + 1_000,
    after: 0,
    ...more,
  } as RunStep
}

const early = [step("start_work", { name: "start_work", label: "Started background work", after: 0 })]
const later = [
  step("one", { after: 2, startedAt: START + 1_000, worker: { id: "w1", task: "compare hotels" } }),
  step("two", { after: 2, startedAt: START + 4_000, worker: { id: "w1", task: "compare hotels" } }),
  step("three", { after: 2, startedAt: START + 7_000, worker: { id: "w1", task: "compare hotels" } }),
]

async function mountThread(messages: ChatMessage[], options: { ready: boolean; seeded: boolean }) {
  await page.viewport(1000, 800)
  fake.ready = options.ready
  fake.steps = options.seeded ? { "kiko#0": early, "kiko#2": later } : {}
  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0;width:1000px;height:800px;display:flex;flex-direction:column"
  const screen = await render(
    () => (
      <VirtualThread
        messages={messages}
        botById={(id) => (id === undefined ? undefined : bot)}
        replyParent={() => undefined}
        firstUnreadMessageId={null}
        onJumpToMessage={() => {}}
        onReplyTarget={() => {}}
        scrollRef={() => {}}
        onStateChange={() => {}}
        waitingNames={[]}
        scrollKey={ROOM}
      />
    ),
    { container: host },
  )
  await vi.waitFor(() => expect(host.querySelectorAll("[data-component=chat-row]").length).toBe(2))
  return screen
}

const heads = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".run-tree-head")]
const worked = (host: HTMLElement) => heads(host).filter((head) => head.textContent?.startsWith("Worked for"))

describe("a run that folded its background activity into the reply", () => {
  it("shows one Worked for summary instead of two", async () => {
    await using screen = await mountThread([owner, activity, reply], { ready: true, seeded: true })

    expect(worked(screen.container)).toHaveLength(1)
    expect(worked(screen.container)[0]!.textContent).toContain("Worked for 10s")
    expect(screen.container.querySelector("[data-component=chat-background]")).toBeNull()
  })

  it("loads the folded window's steps from the server once the chat is ready", async () => {
    fake.deliver = (key) => (key === "kiko#0" ? early : later)
    await using screen = await mountThread([owner, activity, reply], { ready: false, seeded: false })

    heads(screen.container)[0]!.click()
    await vi.waitFor(() => expect(screen.container.textContent).toContain("Loading steps…"))
    expect(screen.container.textContent).not.toContain("Steps unavailable")

    fake.ready = true

    await vi.waitFor(() => expect(screen.container.textContent).toContain("Started background work"))
    expect(screen.container.textContent).toContain("compare hotels")
    expect(screen.container.textContent).not.toContain("Steps unavailable")
  })
})
