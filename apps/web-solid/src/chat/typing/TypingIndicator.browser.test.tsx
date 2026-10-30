import "../../index.css"
import type { RunStep } from "@kiko/protocol"
import { Show } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import type { ChatMessage } from "../../lib/types"
import { MessageRow } from "../ui/MessageRow"
import { TypingIndicator } from "./TypingIndicator"

const START = Date.UTC(2026, 9, 24, 9)

const fake = vi.hoisted(() => ({
  steps: [] as RunStep[],
  live: false,
  liveAfter: 0,
  folded: false,
  pending: [] as { key: string; count?: number }[],
  helpers: [] as unknown[],
}))

vi.mock("../../state/room", async () => {
  const { createSignal: signal } = await import("solid-js")
  const [steps, setSteps] = signal<readonly RunStep[]>([])
  const [live, setLive] = signal(false)
  const [folded, setFolded] = signal(false)
  const [pending, setPending] = signal<{ key: string; count?: number }[]>([])
  const [helpers, setHelpers] = signal<readonly unknown[]>([])
  Object.defineProperty(fake, "steps", { get: steps, set: setSteps })
  Object.defineProperty(fake, "live", { get: live, set: setLive })
  Object.defineProperty(fake, "folded", { get: folded, set: setFolded })
  Object.defineProperty(fake, "pending", { get: pending, set: setPending })
  Object.defineProperty(fake, "helpers", { get: helpers, set: setHelpers })
  const liveKey = () => `kiko#${fake.liveAfter}`
  return {
    fileSrc: () => "",
    room: {
      typingRun: (slug: string) => (live() ? `${slug}#${fake.liveAfter}` : undefined),
      carriesRun: () => live() && steps().some((step) => (step.after ?? 0) === fake.liveAfter),
      runSteps: (key: string) => {
        const after = Number(key.slice(key.lastIndexOf("#") + 1))
        return steps().filter((step) => (step.after ?? 0) === after)
      },
      runLive: (key: string) => live() && key === liveKey(),
      runReady: () => true,
      pendingWindows: () => pending(),
      runWindow: (m: ChatMessage) => (m.botId && m.steps ? `${m.botId}#${m.stepAfter ?? 0}` : undefined),
      runEnd: () => undefined,
      runFetching: () => false,
      loadRunSteps: () => {},
      loadThoughts: () => {},
      thoughtOfRun: () => undefined,
      thoughtFor: () => undefined,
      thinking: () => undefined,
      activeId: () => "room",
      helpers: () => helpers(),
      roomMembers: () => [],
    },
  }
})

const step = (over: Partial<RunStep>): RunStep =>
  ({
    id: "s1",
    runId: "run",
    slug: "kiko",
    tool: "run",
    name: "bash",
    label: "Ran npm test",
    status: "done",
    startedAt: START,
    endedAt: START + 3_000,
    after: 0,
    ...over,
  }) as RunStep

const message: ChatMessage = {
  id: "1.room",
  threadId: "room",
  sender: "bot",
  botId: "kiko",
  seq: 1,
  body: "On it.",
  sentAt: START,
  steps: 1,
  stepAfter: 0,
}

const earlier: ChatMessage = {
  id: "0.room",
  threadId: "room",
  sender: "bot",
  botId: "kiko",
  seq: 0,
  body: "",
  sentAt: START - 1_000,
  steps: 1,
  stepAfter: 1,
  event: { kind: "activity", agent: "kiko" as never, private: true },
}

const bot = { id: "kiko", name: "Kiko", preview: "", updatedAt: 0, presence: "idle" as const, unread: 0, pinned: false }

function Thread(props: { group?: boolean; finished?: ChatMessage; foldedRun?: ChatMessage } = {}) {
  const finished = () => props.finished ?? message
  return (
    <div class="relative mx-auto w-full" style={{ width: "900px" }}>
      <MessageRow
        message={finished()}
        bot={bot}
        quote={null}
        foldedRuns={fake.folded ? [props.foldedRun ?? earlier] : []}
        isRunStart
        isRunEnd
        runKey={`${finished().botId}#${finished().stepAfter ?? 0}`}
        hasRunGapBefore={false}
        group={props.group}
        onOpenReplyTarget={() => {}}
      />
      <Show when={fake.live}>
        <div
          class="mx-auto flex w-full max-w-(--chat-content-max-width) px-4 pb-(--row-gap) pt-(--run-gap)"
          data-component="chat-typing-row"
        >
          <TypingIndicator typists={["kiko"]} seeds={["kiko"]} group={props.group} />
        </div>
      </Show>
      <button type="button" data-testid="end" onClick={() => (fake.live = false)} />
    </div>
  )
}

const box = (element: Element | null | undefined) => element!.getBoundingClientRect()

const left = (element: Element | null | undefined) => box(element).left

const settled: RunStep[] = [step({ after: 0 })]

describe("typing row", () => {
  it("draws one header, not a thinking line plus the tree's own", async () => {
    fake.live = true
    fake.steps = settled
    await using screen = await render(() => <TypingIndicator typists={["kiko"]} seeds={["kiko"]} />)

    await vi.waitFor(() => expect(screen.container.querySelector(".run-tree")).not.toBeNull())
    expect(screen.container.querySelectorAll(".run-tree-head")).toHaveLength(1)
    expect(screen.container.querySelector('[data-component="thinking-line"]')).toBeNull()
  })

  it("keeps the tree in the same spot when it moves from the typing row to under the reply", async () => {
    fake.live = true
    fake.steps = settled
    await using screen = await render(() => <Thread />)

    const tree = () => screen.container.querySelector<HTMLElement>(".run-tree")!
    const top = () => tree().getBoundingClientRect().top

    await vi.waitFor(() => expect(tree()).not.toBeNull())
    await Promise.all(
      screen.container
        .querySelector(".typing")!
        .getAnimations()
        .map((animation) => animation.finished),
    )
    const before = top()
    expect(tree().closest('[data-component="chat-row"]')).toBeNull()

    screen.container.querySelector<HTMLButtonElement>('[data-testid="end"]')!.click()

    await vi.waitFor(() => expect(tree().closest('[data-component="chat-row"]')).not.toBeNull())
    expect(Math.abs(top() - before)).toBeLessThan(2)
  })

  it("shows the earlier window's steps while the run is live, so the handoff keeps them", async () => {
    fake.live = true
    fake.folded = false
    fake.pending = [{ key: "kiko#1", count: 1 }]
    fake.steps = [step({ after: 1, id: "early", label: "Started background work" }), step({ after: 0 })]
    await using screen = await render(() => <Thread />)

    const labels = () => [...screen.container.querySelectorAll(".run-tree-label")].map((row) => row.textContent)
    const tree = () => [...screen.container.querySelectorAll<HTMLElement>(".run-tree")].at(-1)!
    const top = () => tree().getBoundingClientRect().top

    await vi.waitFor(() => expect(labels()).toContain("Started background work"))
    await Promise.all(
      screen.container
        .querySelector(".typing")!
        .getAnimations()
        .map((animation) => animation.finished),
    )
    const before = top()

    fake.live = false
    fake.folded = true

    const reply = () => screen.container.querySelector<HTMLElement>('[data-component="chat-row"] .run-tree-head')!
    await vi.waitFor(() => expect(reply()).not.toBeNull())
    expect(Math.abs(top() - before)).toBeLessThan(2)

    reply().click()
    await vi.waitFor(() => expect(labels()).toContain("Started background work"))
  })
})

const worker = { id: "w1", task: "handoff probe" }

const lane = {
  id: "w1",
  slug: "kiko",
  window: "kiko#1",
  task: worker.task,
  title: "handoff probe",
  state: "working" as const,
  line: "Used slow tool",
  startedAt: START,
  endedAt: undefined,
  count: 1,
  steps: [],
}

const started = () => step({ id: "start", name: "start_work", label: "Started background work", after: 0 })
const inner = (after: number) =>
  step({ id: "inner", label: "Used slow tool", worker, startedAt: START + 1_000, endedAt: START + 2_000, after })

describe("typing row gutter", () => {
  it("draws no avatar in a one-to-one chat and lines its live tree up with the finished one", async () => {
    fake.live = true
    fake.liveAfter = 6
    fake.folded = false
    fake.pending = []
    fake.helpers = []
    fake.steps = [step({ id: "done", after: 5 }), step({ id: "now", after: 6 })]
    await using screen = await render(() => <Thread />)

    const typing = () => screen.container.querySelector<HTMLElement>('[data-component="chat-typing-row"]')!
    const liveHead = () => typing().querySelector<HTMLElement>(".run-tree-head")!
    const finishedHead = () =>
      screen.container.querySelector<HTMLElement>('[data-component="chat-row"] .run-tree-head')!

    await vi.waitFor(() => expect(liveHead()).not.toBeNull())
    expect(typing().querySelector(".typing-bird")).toBeNull()
    expect(Math.abs(left(liveHead()) - left(finishedHead()))).toBeLessThanOrEqual(0.5)
  })

  it("puts the group avatar and tree head where a finished grouped row puts them", async () => {
    fake.live = true
    fake.liveAfter = 6
    fake.folded = false
    fake.pending = []
    fake.helpers = []
    fake.steps = [step({ id: "done", after: 5 }), step({ id: "now", after: 6 })]
    await using screen = await render(() => <Thread group />)

    const typing = () => screen.container.querySelector<HTMLElement>('[data-component="chat-typing-row"]')!
    const bird = () => typing().querySelector<HTMLElement>(".typing-bird")!
    const finishedAvatar = () => screen.container.querySelector<HTMLElement>('[data-component="chat-run-avatar"]')!
    const liveHead = () => typing().querySelector<HTMLElement>(".run-tree-head")!
    const finishedHead = () =>
      screen.container.querySelector<HTMLElement>('[data-component="chat-row"] .run-tree-head')!

    await vi.waitFor(() => expect(liveHead()).not.toBeNull())
    expect(bird()).not.toBeNull()
    expect(Math.abs(left(bird()) - left(finishedAvatar()))).toBeLessThanOrEqual(0.5)
    expect(Math.abs(left(liveHead()) - left(finishedHead()))).toBeLessThanOrEqual(0.5)
  })

  it("shows a live helper once, as a branch, without the step that started it", async () => {
    fake.live = true
    fake.liveAfter = 1
    fake.folded = false
    fake.pending = [{ key: "kiko#0", count: 1 }]
    fake.helpers = [lane]
    fake.steps = [started(), inner(1)]
    await using screen = await render(() => <TypingIndicator typists={["kiko"]} seeds={["kiko"]} />)

    const labels = () => [...screen.container.querySelectorAll(".run-tree-label")].map((row) => row.textContent)
    const helpers = () => screen.container.querySelectorAll('.run-tree-row[data-kind="worker"]')
    await vi.waitFor(() => expect(helpers()).toHaveLength(1))
    expect(labels()).not.toContain("Started background work")
  })

  it("shows a finished helper once, as a branch, without the step that started it", async () => {
    fake.live = false
    fake.folded = true
    fake.helpers = [{ ...lane, window: "kiko#4", state: "done", endedAt: START + 4_000 }]
    fake.steps = [
      started(),
      inner(4),
      step({ id: "second", label: "Used slow tool", worker, startedAt: START + 2_000, after: 4 }),
      step({ id: "third", label: "Used slow tool", worker, startedAt: START + 3_000, after: 4 }),
      step({ id: "fourth", label: "Used slow tool", worker, startedAt: START + 4_000, after: 4 }),
    ]
    const reply: ChatMessage = { ...message, id: "5.room", body: "report w1 done", steps: 4, stepAfter: 4 }
    const activity: ChatMessage = { ...earlier, id: "4.room", stepAfter: 0 }
    await using screen = await render(() => <Thread finished={reply} foldedRun={activity} />)

    const labels = () => [...screen.container.querySelectorAll(".run-tree-label")].map((row) => row.textContent)
    const head = () => screen.container.querySelector<HTMLElement>('[data-component="chat-row"] .run-tree-head')!

    await vi.waitFor(() => expect(head()).not.toBeNull())
    head().click()
    const helpers = () => screen.container.querySelectorAll('.run-tree-row[data-kind="worker"]')
    await vi.waitFor(() => expect(helpers()).toHaveLength(1))
    expect(labels()).not.toContain("Started background work")
  })
})
