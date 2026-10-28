import "../../index.css"
import type { RunStep } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import { RunTree, toggleRun } from "./RunTree"

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

const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".run-tree-row")]
const head = (host: HTMLElement) => host.querySelector<HTMLElement>(".run-tree-head")!

describe("RunTree", () => {
  it("keeps the live log to one line until it is opened, then lists every step in order", async () => {
    fake.steps = [
      step("ls", { startedAt: START }),
      step("cat", { startedAt: START + 4_000 }),
      step("split.py", { startedAt: START + 8_000, status: "running", endedAt: undefined }),
    ]
    fake.live = true
    await using screen = await render(() => <RunTree windowKey="kiko#0" />)

    expect(rows(screen.container)).toHaveLength(0)
    expect(head(screen.container)).toBeNull()

    toggleRun("kiko#0")

    await vi.waitFor(() => expect(rows(screen.container)).toHaveLength(3))
    const running = rows(screen.container)[2]!
    expect(running.textContent).toContain("split.py")
    expect(running.querySelector('[data-component="mochi"]')).not.toBeNull()
    toggleRun("kiko#0")
  })

  it("shows the first steps of a long log and the rest on request", async () => {
    fake.live = false
    fake.steps = Array.from({ length: 14 }, (_, i) => step(`s${i}`, { startedAt: START + i * 1_000 }))
    await using screen = await render(() => <RunTree windowKey="kiko#5" count={14} endedAt={START + 20_000} />)
    head(screen.container).click()

    await vi.waitFor(() => expect(screen.container.textContent).toContain("Show all steps"))
    expect(rows(screen.container).filter((row) => row.dataset.kind === "step")).toHaveLength(6)

    screen.container.querySelector<HTMLElement>(".run-tree-more")!.click()

    await vi.waitFor(() => expect(rows(screen.container).filter((row) => row.dataset.kind === "step")).toHaveLength(14))
  })

  it("sums up the work and how long it took, from its first step to its reply, and opens to the steps", async () => {
    fake.live = false
    fake.steps = [
      step("a", { startedAt: START, endedAt: START + 2_000 }),
      step("b", { startedAt: START + 2_000, endedAt: START + 12_000 }),
    ]
    await using screen = await render(() => <RunTree windowKey="kiko#0" count={2} endedAt={START + 75_000} />)

    expect(head(screen.container).textContent).toBe("Ran 2 commands1m 15s")
    expect(rows(screen.container)).toHaveLength(0)

    head(screen.container).click()

    await vi.waitFor(() => expect(rows(screen.container)).toHaveLength(2))
    expect(rows(screen.container).map((row) => row.querySelector(".run-tree-label")!.textContent)).toEqual([
      "Ran a",
      "Ran b",
    ])
  })

  it("tells how long each call took, shown on hover", async () => {
    fake.live = false
    fake.steps = [step("solo", { startedAt: START, endedAt: START + 4_200 })]
    await using screen = await render(() => <RunTree windowKey="kiko#9" count={1} endedAt={START + 5_000} />)
    head(screen.container).click()
    const time = await vi.waitFor(() => rows(screen.container)[0]!.querySelector<HTMLElement>(".run-tree-time")!)

    expect(time.textContent).toBe("4.2s")
    expect(getComputedStyle(time).opacity).toBe("0")
  })

  it("marks a helper failed until a retry of the failed step works, and never marks the whole log", async () => {
    const worker = { id: "w1", task: "Food helper" }
    const [retried, setRetried] = createSignal(false)
    fake.live = false
    fake.steps = [step("search", { worker, status: "failed", name: "web_search", tool: "search" })]
    await using screen = await render(() => <RunTree windowKey="kiko#0" count={retried() ? 2 : 1} />)
    head(screen.container).click()
    const helper = () => rows(screen.container).find((row) => row.dataset.kind === "worker")!

    await vi.waitFor(() => expect(helper().hasAttribute("data-failed")).toBe(true))
    expect(head(screen.container).querySelector("[data-failed]")).toBeNull()

    fake.steps = [
      ...fake.steps,
      step("search-again", { worker, name: "web_search", tool: "search", startedAt: START + 5_000 }),
    ]
    setRetried(true)

    await vi.waitFor(() => expect(helper().hasAttribute("data-failed")).toBe(false))
    expect(head(screen.container).querySelector("[data-failed]")).toBeNull()
  })

  it("keeps its summary and how long it worked once the steps are no longer loaded", async () => {
    fake.live = false
    fake.steps = [step("a", { startedAt: START, endedAt: START + 5_000 })]
    {
      await using first = await render(() => <RunTree windowKey="kiko#7" count={1} endedAt={START + 8_000} />)
      expect(head(first.container).textContent).toBe("Ran a command8.0s")
    }
    fake.steps = []
    await using screen = await render(() => <RunTree windowKey="kiko#7" count={1} endedAt={START + 8_000} />)

    expect(head(screen.container).textContent).toBe("Ran a command8.0s")
  })

  it("folds the steps someone opened while it worked once the reply lands, and opens again on request", async () => {
    fake.steps = [step("ls", { startedAt: START }), step("cat", { startedAt: START + 1_000 })]
    fake.live = true
    await using screen = await render(() => <RunTree windowKey="kiko#3" count={2} />)
    toggleRun("kiko#3")
    await vi.waitFor(() => expect(rows(screen.container)).toHaveLength(2))

    fake.live = false

    await vi.waitFor(() => expect(head(screen.container).getAttribute("aria-expanded")).toBe("false"))
    await vi.waitFor(() => expect(rows(screen.container)).toHaveLength(0))

    head(screen.container).click()

    await vi.waitFor(() => expect(rows(screen.container)).toHaveLength(2))
    expect(head(screen.container).getAttribute("aria-expanded")).toBe("true")
  })

  it("leaves a log nobody opened while it worked folded when the reply lands", async () => {
    fake.steps = [step("ls", { startedAt: START })]
    fake.live = true
    await using screen = await render(() => <RunTree windowKey="kiko#4" count={1} />)
    fake.live = false

    await vi.waitFor(() => expect(head(screen.container).getAttribute("aria-expanded")).toBe("false"))
    expect(rows(screen.container)).toHaveLength(0)
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
