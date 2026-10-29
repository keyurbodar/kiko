import "../../index.css"
import type { RunStep } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../../test/render"
import { fullTimeLabel } from "./duration"
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
    fileSrc: () => "",
    room: {
      runSteps: (key: string) => {
        const after = Number(key.slice(key.lastIndexOf("#") + 1))
        return steps().filter((step) => (step.after ?? 0) === after)
      },
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
const labels = (host: HTMLElement) => rows(host).map((row) => row.querySelector(".run-tree-label")?.textContent)
const tip = () => document.querySelector<HTMLElement>('[data-component="tooltip-v2"]')

function tokenColor(token: string): string {
  const probe = document.createElement("div")
  probe.style.color = `var(${token})`
  document.body.append(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value
}

describe("RunTree", () => {
  it("shows a live run's rows in order, with the running step marked", async () => {
    fake.steps = [
      step("ls", { startedAt: START }),
      step("cat", { startedAt: START + 4_000 }),
      step("split.py", { startedAt: START + 8_000, status: "running", endedAt: undefined }),
    ]
    fake.live = true
    await using screen = await render(() => <RunTree windowKey="kiko#0" />)

    await vi.waitFor(() => expect(rows(screen.container)).toHaveLength(3))
    expect(labels(screen.container)).toEqual(["Ran ls", "Ran cat", "Running split.py"])
    expect(head(screen.container).textContent).toContain("Running split.py")
    const running = rows(screen.container)[2]!
    expect(running.querySelector('[data-component="mochi"]')).not.toBeNull()
    expect(running.hasAttribute("data-running")).toBe(true)
  })

  it("folds a finished run to Worked for, and opens the tree when clicked", async () => {
    fake.live = false
    fake.steps = [
      step("a", { after: 10, startedAt: START, endedAt: START + 2_000 }),
      step("b", { after: 10, startedAt: START + 2_000, endedAt: START + 12_000 }),
    ]
    await using screen = await render(() => <RunTree windowKey="kiko#10" count={2} endedAt={START + 20_000} />)

    expect(head(screen.container).querySelector(".run-tree-summary")?.textContent).toBe("Worked for 20s")
    expect(rows(screen.container)).toHaveLength(0)

    head(screen.container).click()

    await vi.waitFor(() => expect(rows(screen.container)).toHaveLength(2))
    expect(head(screen.container).getAttribute("aria-expanded")).toBe("true")
    expect(labels(screen.container)).toEqual(["Ran a", "Ran b"])
  })

  it("closes the running step when the call finishes after a restart", async () => {
    fake.live = true
    fake.steps = [step("run", { after: 11, status: "running", endedAt: undefined })]
    await using screen = await render(() => <RunTree windowKey="kiko#11" />)

    await vi.waitFor(() => expect(screen.container.querySelector('[data-component="mochi"]')).not.toBeNull())

    fake.steps = [step("run", { after: 11, status: "done", endedAt: START + 2_000 })]

    await vi.waitFor(() => expect(screen.container.querySelector('[data-component="mochi"]')).toBeNull())
    expect(rows(screen.container)[0]!.hasAttribute("data-running")).toBe(false)
  })

  it("marks a failed child's helper branch until a retry of that step succeeds", async () => {
    const worker = { id: "w1", task: "Food helper" }
    const [retried, setRetried] = createSignal(false)
    fake.live = false
    fake.steps = [step("search", { after: 12, worker, status: "failed", name: "web_search", tool: "search" })]
    await using screen = await render(() => <RunTree windowKey="kiko#12" count={retried() ? 2 : 1} />)
    head(screen.container).click()
    const helper = () => rows(screen.container).find((row) => row.dataset.kind === "worker")!

    await vi.waitFor(() => expect(helper().hasAttribute("data-failed")).toBe(true))
    expect(helper().querySelector(".run-tree-leaves")!.hasAttribute("data-failed")).toBe(true)
    expect(head(screen.container).querySelector("[data-failed]")).toBeNull()

    fake.steps = [
      ...fake.steps,
      step("search-again", {
        after: 12,
        worker,
        name: "web_search",
        tool: "search",
        startedAt: START + 5_000,
      }),
    ]
    setRetried(true)

    await vi.waitFor(() => expect(helper().hasAttribute("data-failed")).toBe(false))
    expect(helper().querySelector(".run-tree-leaves")!.hasAttribute("data-failed")).toBe(false)
    expect(head(screen.container).querySelector("[data-failed]")).toBeNull()
  })

  it("folds a helper branch to its step count, then shows its steps when opened", async () => {
    const worker = { id: "w1", task: "Trains helper" }
    fake.live = false
    fake.steps = [
      step("a", { after: 13, worker, startedAt: START }),
      step("b", { after: 13, worker, startedAt: START + 1_000 }),
      step("c", { after: 13, worker, startedAt: START + 2_000 }),
    ]
    await using screen = await render(() => <RunTree windowKey="kiko#13" count={3} />)
    head(screen.container).click()

    const helper = await vi.waitFor(() => rows(screen.container).find((row) => row.dataset.kind === "worker")!)
    expect(helper.textContent).toContain("Trains helper")
    expect(helper.textContent).toContain("done, 3 steps")
    expect(rows(screen.container).filter((row) => row.dataset.kind === "step")).toHaveLength(0)

    helper.click()

    await vi.waitFor(() => expect(rows(screen.container).filter((row) => row.dataset.kind === "step")).toHaveLength(3))
  })

  it("never shows a step from an earlier run", async () => {
    fake.live = false
    fake.steps = [step("old", { after: 0, startedAt: START }), step("new", { after: 5, startedAt: START + 10_000 })]
    await using screen = await render(() => <RunTree windowKey="kiko#5" count={1} endedAt={START + 20_000} />)
    head(screen.container).click()

    await vi.waitFor(() => expect(rows(screen.container)).toHaveLength(1))
    expect(labels(screen.container)).toEqual(["Ran new"])
  })

  it("shows the first steps of a long log and the rest on request", async () => {
    fake.live = false
    fake.steps = Array.from({ length: 14 }, (_, i) => step(`s${i}`, { after: 14, startedAt: START + i * 1_000 }))
    await using screen = await render(() => <RunTree windowKey="kiko#14" count={14} endedAt={START + 20_000} />)
    head(screen.container).click()

    await vi.waitFor(() => expect(screen.container.textContent).toContain("+8 steps"))
    expect(rows(screen.container).filter((row) => row.dataset.kind === "step")).toHaveLength(6)

    screen.container.querySelector<HTMLElement>(".run-tree-more")!.click()

    await vi.waitFor(() => expect(rows(screen.container).filter((row) => row.dataset.kind === "step")).toHaveLength(14))
  })

  it("brightens the whole row, label included, and reveals the start time on hover", async () => {
    fake.live = false
    fake.steps = [step("a", { after: 20, startedAt: START, endedAt: START + 4_000 })]
    await using screen = await render(() => <RunTree windowKey="kiko#20" count={1} endedAt={START + 6_000} />)
    head(screen.container).click()

    const row = await vi.waitFor(() => rows(screen.container)[0]!)
    const label = row.querySelector<HTMLElement>(".run-tree-label")!
    const time = row.querySelector<HTMLElement>(".run-tree-time")!
    expect(getComputedStyle(time).opacity).toBe("0")

    await userEvent.hover(row)

    const bright = tokenColor("--text-100")
    await vi.waitFor(() => expect(getComputedStyle(label).color).toBe(bright))
    await vi.waitFor(() => expect(getComputedStyle(time).opacity).toBe("1"))

    await userEvent.hover(time)
    await vi.waitFor(() => expect(tip()?.textContent).toContain(fullTimeLabel(START)))
  })

  it("reveals the start time on the folded footer, with the full time in a tooltip", async () => {
    fake.live = false
    fake.steps = [step("a", { after: 21, startedAt: START, endedAt: START + 2_000 })]
    await using screen = await render(() => <RunTree windowKey="kiko#21" count={1} endedAt={START + 12_000} />)

    const footer = head(screen.container)
    const time = footer.querySelector<HTMLElement>(".run-tree-time")!
    expect(getComputedStyle(time).opacity).toBe("0")

    await userEvent.hover(footer)
    await vi.waitFor(() => expect(getComputedStyle(time).opacity).toBe("1"))

    await userEvent.hover(time)
    await vi.waitFor(() => expect(tip()?.textContent).toContain(fullTimeLabel(START)))
  })

  it("shows helpers as private lanes and keeps them out of the step rows", async () => {
    fake.live = false
    const worker = { id: "w1", task: "Try 3 hero layouts" }
    fake.steps = [
      step("plain", { after: 15, startedAt: START }),
      step("inner", { after: 15, startedAt: START + 1_000, worker }),
    ]
    fake.helpers = [
      {
        id: "w1",
        slug: "kiko",
        window: "kiko#15",
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
    await using screen = await render(() => <RunTree windowKey="kiko#15" count={2} />)
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
