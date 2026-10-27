import "../../index.css"
import type { RunStep } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import { RunTree } from "./RunTree"

const fake = vi.hoisted(() => ({ steps: [] as RunStep[], live: false, helpers: [] as unknown[] }))

vi.mock("../../state/room", async () => {
  const { createSignal: signal } = await import("solid-js")
  const [steps, setSteps] = signal<readonly RunStep[]>([])
  const [live, setLive] = signal(false)
  const [helpers, setHelpers] = signal<readonly unknown[]>([])
  Object.defineProperty(fake, "helpers", { get: helpers, set: setHelpers })
  Object.defineProperty(fake, "steps", { get: steps, set: setSteps })
  Object.defineProperty(fake, "live", { get: live, set: setLive })
  return {
    room: {
      runSteps: () => steps(),
      runLive: () => live(),
      runFetching: () => false,
      loadRunSteps: () => {},
      activeId: () => "room",
      helpers: () => helpers(),
      roomMembers: () => [],
    },
  }
})

vi.mock("../side/surfaces", () => ({
  fixedSurface: () => ({}),
  openFile: () => {},
  openSurface: () => {},
  deskView: () => null,
  helperSurface: () => ({}),
}))

vi.mock("../ui/find-file", () => ({ findFile: () => null }))

const START = Date.UTC(2024, 9, 24, 9)

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
    endedAt: START + 4_000,
    after: 0,
    ...more,
  } as RunStep
}

const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".run-tree-row:not(.run-tree-head)")]

describe("RunTree", () => {
  it("bounces the mascot on the running step and lights the branch down to it", async () => {
    fake.steps = [
      step("ls", { startedAt: START }),
      step("split.py", { startedAt: START + 5_000, status: "running", endedAt: undefined }),
    ]
    fake.live = true
    await using screen = await render(() => <RunTree windowKey="kiko#0" />)
    const [done, running] = rows(screen.container)

    expect(running!.querySelector('[data-component="mochi"]')).not.toBeNull()
    expect(done!.querySelector('[data-component="mochi"]')).toBeNull()
    expect(done!.hasAttribute("data-path")).toBe(true)
    expect(running!.hasAttribute("data-path")).toBe(true)
    expect(done!.querySelector('[data-component="run-tree-took"]')!.textContent).toBe("4s")
    expect(running!.querySelector('[data-component="run-tree-took"]')!.textContent).toMatch(/^\d+m \d+s$/)
  })

  it("marks a helper failed until a retry of the failed step works", async () => {
    const worker = { id: "w1", task: "Food helper" }
    const [retried, setRetried] = createSignal(false)
    fake.live = false
    fake.steps = [step("search", { worker, status: "failed", name: "web_search", tool: "search" })]
    await using screen = await render(() => <RunTree windowKey="kiko#0" count={retried() ? 2 : 1} />)
    const head = () => screen.container.querySelector<HTMLElement>(".run-tree-head")!
    head().click()
    const helper = () => rows(screen.container).find((row) => row.dataset.kind === "worker")!

    await vi.waitFor(() => expect(helper().hasAttribute("data-failed")).toBe(true))
    expect(head().querySelector("[data-failed]")).not.toBeNull()

    fake.steps = [
      ...fake.steps,
      step("search-again", { worker, name: "web_search", tool: "search", startedAt: START + 5_000 }),
    ]
    setRetried(true)

    await vi.waitFor(() => expect(helper().hasAttribute("data-failed")).toBe(false))
    expect(head().querySelector("[data-failed]")).toBeNull()
  })

  it("shows how long the whole run took on its summary", async () => {
    fake.live = false
    fake.steps = [
      step("a", { startedAt: START, endedAt: START + 2_000 }),
      step("b", { startedAt: START + 2_000, endedAt: START + 12_000 }),
    ]
    await using screen = await render(() => <RunTree windowKey="kiko#0" count={2} />)

    const head = screen.container.querySelector<HTMLElement>(".run-tree-head")!
    expect(head.textContent).toContain("Ran 2 commands")
    expect(head.querySelector('[data-component="run-tree-took"]')!.textContent).toBe("12s")
  })

  it("keeps the summary and time it showed once the steps are no longer loaded", async () => {
    fake.live = false
    fake.steps = [step("a", { startedAt: START, endedAt: START + 5_000 })]
    {
      await using first = await render(() => <RunTree windowKey="kiko#7" count={1} />)
      expect(first.container.querySelector(".run-tree-head")!.textContent).toContain("Ran 1 command")
    }
    fake.steps = []
    await using screen = await render(() => <RunTree windowKey="kiko#7" count={1} />)

    const head = screen.container.querySelector<HTMLElement>(".run-tree-head")!
    expect(head.textContent).toContain("Ran 1 command")
    expect(head.querySelector('[data-component="run-tree-took"]')!.textContent).toBe("5s")
  })

  it("shows a step's own time only when it differs from the summary's", async () => {
    fake.live = false
    fake.steps = [step("solo", { startedAt: START, endedAt: START + 5_000 })]
    await using screen = await render(() => <RunTree windowKey="kiko#8" count={1} />)
    screen.container.querySelector<HTMLElement>(".run-tree-head")!.click()

    await vi.waitFor(() => expect(rows(screen.container)).toHaveLength(1))
    expect(rows(screen.container)[0]!.querySelector('[data-component="run-tree-took"]')).toBeNull()
  })

  it("shows helpers as private lanes and keeps them out of the step rows", async () => {
    fake.live = false
    const worker = { id: "w1", task: "Try 3 hero layouts" }
    fake.steps = [step("plain", { startedAt: START }), step("inner", { startedAt: START + 1_000, worker })]
    fake.helpers = [
      {
        id: "w1",
        slug: "kiko",
        window: "kiko#9",
        task: worker.task,
        title: "Try 3 hero layouts",
        state: "done",
        line: "Ran inner",
        startedAt: START + 1_000,
        endedAt: START + 5_000,
        count: 1,
        steps: [],
      },
    ]
    await using screen = await render(() => <RunTree windowKey="kiko#9" count={2} />)
    screen.container.querySelector<HTMLElement>(".run-tree-head")!.click()

    await vi.waitFor(() => expect(rows(screen.container)).toHaveLength(1))
    expect(rows(screen.container)[0]!.getAttribute("data-kind")).toBe("step")
    const lanes = screen.container.querySelector('[data-component="helper-lanes"]')!
    expect(lanes.textContent).toContain("Started a helper")
    expect(lanes.textContent).toContain("Private to")
    expect(lanes.querySelectorAll('[data-component="helper-lane"]')).toHaveLength(1)
    fake.helpers = []
  })
})
