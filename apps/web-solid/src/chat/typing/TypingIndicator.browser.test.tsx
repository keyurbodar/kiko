import "../../index.css"
import type { RunStep } from "@kiko/protocol"
import { Show } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import type { ChatMessage } from "../../lib/types"
import { MessageRow } from "../ui/MessageRow"
import { TypingIndicator } from "./TypingIndicator"

const START = Date.UTC(2026, 9, 24, 9)
const KEY = "kiko#0"

const fake = vi.hoisted(() => ({ steps: [] as RunStep[], live: false }))

vi.mock("../../state/room", async () => {
  const { createSignal: signal } = await import("solid-js")
  const [steps, setSteps] = signal<readonly RunStep[]>([])
  const [live, setLive] = signal(false)
  Object.defineProperty(fake, "steps", { get: steps, set: setSteps })
  Object.defineProperty(fake, "live", { get: live, set: setLive })
  return {
    fileSrc: () => "",
    room: {
      typingRun: (slug: string) => (live() ? `${slug}#0` : undefined),
      runSteps: (key: string) => {
        const after = Number(key.slice(key.lastIndexOf("#") + 1))
        return steps().filter((step) => (step.after ?? 0) === after)
      },
      runLive: () => live(),
      runWindow: () => KEY,
      runEnd: () => undefined,
      runFetching: () => false,
      loadRunSteps: () => {},
      loadThoughts: () => {},
      thoughtOfRun: () => undefined,
      thoughtFor: () => undefined,
      thinking: () => undefined,
      activeId: () => "room",
      helpers: () => [],
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

const bot = { id: "kiko", name: "Kiko", preview: "", updatedAt: 0, presence: "idle" as const, unread: 0, pinned: false }

function Thread() {
  return (
    <div class="relative mx-auto w-full" style={{ width: "900px" }}>
      <MessageRow
        message={message}
        bot={bot}
        quote={null}
        isRunStart
        isRunEnd
        runKey={KEY}
        hasRunGapBefore={false}
        onOpenReplyTarget={() => {}}
      />
      <Show when={fake.live}>
        <div class="mx-auto flex w-full max-w-(--chat-content-max-width) px-4 pb-(--row-gap) pt-(--run-gap)">
          <TypingIndicator typists={["kiko"]} seeds={["kiko"]} />
        </div>
      </Show>
      <button type="button" data-testid="end" onClick={() => (fake.live = false)} />
    </div>
  )
}

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
})
