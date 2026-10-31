import "../../index.css"
import type { RunStep } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { page } from "vitest/browser"
import { render } from "../../../test/render"
import { fakeTimers } from "../../../test/timers"
import { heardThought, restoredThought } from "../../state/thoughts"
import { fullTimeLabel } from "./duration"
import { RunTree } from "./RunTree"

const fake = vi.hoisted(() => ({
  steps: [] as RunStep[],
  live: false,
  helpers: [] as unknown[],
  end: undefined as { at: number; label: string } | undefined,
  restored: undefined as unknown,
  asked: [] as string[],
}))

vi.mock("../../state/room", async () => {
  const { createSignal: signal } = await import("solid-js")
  const [steps, setSteps] = signal<readonly RunStep[]>([])
  const [live, setLive] = signal(false)
  const [helpers, setHelpers] = signal<readonly unknown[]>([])
  const [end, setEnd] = signal<{ at: number; label: string } | undefined>(undefined)
  const [restored, setRestored] = signal<unknown>(undefined)
  Object.defineProperty(fake, "helpers", { get: helpers, set: setHelpers })
  Object.defineProperty(fake, "end", { get: end, set: setEnd })
  Object.defineProperty(fake, "restored", { get: restored, set: setRestored })
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
      runReady: () => true,
      runFetching: () => false,
      loadRunSteps: () => {},
      runEnd: () => end(),
      thoughtOfRun: () => restored(),
      loadThoughts: (slug: string, runId: string) => {
        fake.asked.push(`${slug}:${runId}`)
      },
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
const items = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".run-tree-item")]
const elbowOf = (item: HTMLElement) => getComputedStyle(item, "::after")
const railOf = (item: HTMLElement) => getComputedStyle(item, "::before")

function tokenColor(token: string, host: HTMLElement = document.body): string {
  const probe = document.createElement("div")
  probe.style.color = `var(${token})`
  host.append(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value
}

async function openTree(host: HTMLElement, count: number) {
  head(host).click()
  return vi.waitFor(() => {
    const found = items(host)
    expect(found).toHaveLength(count)
    return found
  })
}

function authored(selector: string, property: string): string {
  let value = ""
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.split(",").some((part) => part.trim() === selector))
        continue
      const found = rule.style.getPropertyValue(property)
      if (found) value = found
    }
  }
  return value
}

describe("RunTree", () => {
  it("shows a live run's rows in order under a tally of its steps, with the running step marked", async () => {
    fake.steps = [
      step("ls", { startedAt: START }),
      step("cat", { startedAt: START + 4_000 }),
      step("split.py", { startedAt: START + 8_000, status: "running", endedAt: undefined }),
    ]
    fake.live = true
    await using screen = await render(() => <RunTree windowKey="kiko#0" />)

    await vi.waitFor(() => expect(rows(screen.container)).toHaveLength(3))
    expect(labels(screen.container)).toEqual(["Ran ls", "Ran cat", "Running split.py"])
    expect(head(screen.container).querySelector(".run-tree-summary")?.textContent).toBe("Ran 3 commands")
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

  it("hangs a helper off the tree as a branch with its steps under it", async () => {
    fake.live = false
    const worker = { id: "w1", task: "Try 3 hero layouts" }
    fake.steps = [
      step("plain", { after: 15, startedAt: START }),
      step("inner", { after: 15, startedAt: START + 1_000, worker }),
    ]
    await using screen = await render(() => <RunTree windowKey="kiko#15" count={2} />)
    screen.container.querySelector<HTMLElement>(".run-tree-head")!.click()

    await vi.waitFor(() => expect(rows(screen.container)).toHaveLength(2))
    expect(rows(screen.container).map((row) => row.getAttribute("data-kind"))).toEqual(["step", "worker"])
    expect(rows(screen.container)[1]!.textContent).toContain("Try 3 hero layouts")
    expect(screen.container.querySelector('[data-component="helper-lanes"]')).toBeNull()
    rows(screen.container)[1]!.click()
    await vi.waitFor(() =>
      expect(screen.container.querySelectorAll(".run-tree-children > .run-tree-item")).toHaveLength(1),
    )
  })

  it("hangs every step off a 30px row on a 1.5px rail drawn in one opaque color", async () => {
    fake.live = false
    fake.steps = [
      step("a", { after: 30, startedAt: START, endedAt: START + 2_000 }),
      step("b", { after: 30, startedAt: START + 2_000, endedAt: START + 4_000 }),
    ]
    await using screen = await render(() => <RunTree windowKey="kiko#30" count={2} endedAt={START + 6_000} />)
    const [first, last] = await openTree(screen.container, 2)

    const row = first!.querySelector<HTMLElement>(".run-tree-row")!
    expect(getComputedStyle(row).height).toBe("30px")
    expect(getComputedStyle(row).gap).toBe("9px")

    const rail = railOf(first!).borderLeftColor
    const elbow = elbowOf(first!)
    expect(elbow.borderLeftColor).toBe(rail)
    expect(elbow.borderBottomColor).toBe(rail)
    expect(elbow.borderLeftWidth).toBe(railOf(first!).borderLeftWidth)
    expect(elbow.borderBottomWidth).toBe(railOf(first!).borderLeftWidth)
    expect(railOf(last!).display).toBe("none")
    expect(rail).not.toMatch(/\/\s*0?\.\d|rgba|transparent/)
    expect(authored(".run-tree-item::before", "border-left")).toBe("var(--run-stroke) solid var(--run-rail)")
    expect(authored(".run-tree-item::after", "border-bottom")).toBe("var(--run-stroke) solid var(--run-rail)")
  })

  it("centers each elbow on its row and puts open output in the label column", async () => {
    fake.live = false
    fake.steps = [step("a", { after: 34, startedAt: START, endedAt: START + 2_000 })]
    await using screen = await render(() => <RunTree windowKey="kiko#34" count={1} endedAt={START + 6_000} />)
    const [item] = await openTree(screen.container, 1)
    const row = item!.querySelector<HTMLElement>(".run-tree-row")!
    const elbow = elbowOf(item!)
    const stroke = Number.parseFloat(elbow.borderBottomWidth)
    const strokeMid = item!.getBoundingClientRect().top + Number.parseFloat(elbow.height) - stroke / 2
    const rowBox = row.getBoundingClientRect()
    expect(strokeMid).toBeCloseTo(rowBox.top + rowBox.height / 2, 0)

    row.click()
    const detail = await vi.waitFor(() => {
      const found = item!.querySelector<HTMLElement>(".run-tree-detail")
      expect(found).not.toBeNull()
      return found!
    })
    const label = row.querySelector(".run-tree-label")!.getBoundingClientRect().left
    const text = detail.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(detail).paddingLeft)
    expect(text).toBeCloseTo(label, 2)
  })

  it("hangs a helper's steps from its icon, with their icons in its label column", async () => {
    const worker = { id: "w1", task: "Trains helper" }
    fake.live = false
    fake.steps = [
      step("a", { after: 31, worker, startedAt: START }),
      step("b", { after: 31, worker, startedAt: START + 1_000 }),
    ]
    await using screen = await render(() => <RunTree windowKey="kiko#31" count={2} />)
    await openTree(screen.container, 1)

    const helper = rows(screen.container).find((row) => row.dataset.kind === "worker")!
    helper.click()
    const [firstStep, helperStep] = await vi.waitFor(() => {
      const found = [...screen.container.querySelectorAll<HTMLElement>(".run-tree-children > .run-tree-item")]
      expect(found).toHaveLength(2)
      return found
    })

    const slot = helper.querySelector(".run-tree-slot")!.getBoundingClientRect()
    const glyph = helper.querySelector(".run-tree-leaves > i")!.getBoundingClientRect()
    const label = helper.querySelector(".run-tree-label")!.getBoundingClientRect()
    const childIcon = firstStep!.querySelector(".run-tree-slot")!.getBoundingClientRect()
    expect(childIcon.left).toBeCloseTo(label.left, 2)
    expect(childIcon.width).toBe(slot.width)

    const elbow = elbowOf(firstStep!)
    const railMid =
      firstStep!.getBoundingClientRect().left +
      Number.parseFloat(elbow.left) +
      Number.parseFloat(elbow.borderLeftWidth) / 2
    expect(railMid).toBeCloseTo(slot.left + slot.width / 2, 0)
    expect(glyph.width).toBeLessThan(slot.width)
    expect(glyph.left + glyph.width / 2).toBeCloseTo(slot.left + slot.width / 2, 2)
    expect(railOf(helperStep!).display).toBe("none")
  })

  it("turns the branch white from the top down to the running step", async () => {
    fake.live = true
    fake.steps = [
      step("a", { after: 32, startedAt: START, endedAt: START + 2_000 }),
      step("b", { after: 32, startedAt: START + 2_000, endedAt: START + 4_000 }),
      step("c", { after: 32, startedAt: START + 4_000, status: "running", endedAt: undefined }),
    ]
    await using screen = await render(() => <RunTree windowKey="kiko#32" />)
    const found = await vi.waitFor(() => {
      const all = items(screen.container)
      expect(all).toHaveLength(3)
      return all
    })

    const white = tokenColor("--text-100")
    const rail = tokenColor("--run-rail", screen.container.querySelector<HTMLElement>(".run-tree")!)

    expect(found[0]!.hasAttribute("data-live")).toBe(true)
    expect(found[0]!.hasAttribute("data-hot")).toBe(false)
    expect(railOf(found[0]!).borderLeftColor).toBe(white)
    expect(elbowOf(found[0]!).borderLeftColor).toBe(white)
    expect(elbowOf(found[0]!).borderBottomColor).toBe(rail)

    expect(found[2]!.hasAttribute("data-hot")).toBe(true)
    expect(railOf(found[2]!).borderLeftColor).toBe(white)
    expect(elbowOf(found[2]!).borderLeftColor).toBe(white)
    expect(elbowOf(found[2]!).borderBottomColor).toBe(white)
  })

  it("settles a tree that mounts right after its run with no second enter animation", async () => {
    using _timers = fakeTimers()
    vi.setSystemTime(START + 21_000)
    fake.live = false
    fake.end = { at: START + 20_900, label: "Used 2 tools" }
    fake.steps = [step("a", { after: 40, startedAt: START, endedAt: START + 2_000 })]
    await using screen = await render(() => <RunTree windowKey="kiko#40" count={1} endedAt={START + 20_000} />)

    expect(screen.container.querySelectorAll(".run-tree-head")).toHaveLength(1)
    expect(screen.container.querySelector(".run-tree-cross-in")?.textContent).toBe("Worked for 20s")
    expect(screen.container.querySelector(".run-tree-item[data-fresh]")).toBeNull()
  })

  it("restores a finished run's thinking from the room when its tree opens", async () => {
    fake.live = false
    fake.end = undefined
    fake.restored = undefined
    fake.asked = []
    fake.steps = [step("a", { after: 41, runId: "room:kiko:9", startedAt: START, endedAt: START + 2_000 })]
    await using screen = await render(() => <RunTree windowKey="kiko#41" count={1} endedAt={START + 4_000} />)
    expect(screen.container.querySelector('.run-tree-item[data-kind="thought"]')).toBeNull()

    head(screen.container).click()
    expect(fake.asked).toEqual(["kiko:room:kiko:9"])

    fake.restored = restoredThought("kiko", "room:kiko:9", [
      { part: 0, text: "Quiet first.", startedAt: START, spentMs: 3_000 },
    ])

    const row = await vi.waitFor(() => {
      const found = screen.container.querySelector<HTMLElement>('.run-tree-item[data-kind="thought"]')
      expect(found).not.toBeNull()
      return found!
    })
    expect(row.textContent).toContain("Thought for 3s")

    row.querySelector<HTMLButtonElement>("button")!.click()
    await vi.waitFor(() =>
      expect(screen.container.querySelector(".thinking-stream")?.textContent).toContain("Quiet first."),
    )
  })

  it("wraps long reasoning inside its column at 390px", async () => {
    await page.viewport(390, 844)
    fake.end = undefined
    fake.live = true
    fake.steps = [step("a", { after: 42, startedAt: START, status: "running", endedAt: undefined })]
    const long = `${"quiet hotel near the station with breakfast included ".repeat(12)}\n\nhttps://example.com/${"very-long-path-segment".repeat(6)}`
    const thought = heardThought(
      undefined,
      { slug: "kiko", runId: "run", part: 0, offset: 0, text: long, startedAt: START, done: false },
      START + 1_000,
      0,
    )
    await using screen = await render(() => <RunTree windowKey="kiko#42" thought={thought} />)

    const box = await vi.waitFor(() => {
      const found = screen.container.querySelector<HTMLElement>(".thinking-stream")
      expect(found).not.toBeNull()
      return found!
    })
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
    expect(screen.container.querySelector(".run-tree")!.getBoundingClientRect().right).toBeLessThanOrEqual(390)
    await page.viewport(1280, 720)
  })

  it("keeps the list element when a step signal arrives mid-run", async () => {
    fake.end = undefined
    fake.restored = undefined
    fake.live = true
    fake.steps = [step("a", { after: 43, status: "running", endedAt: undefined })]
    await using screen = await render(() => <RunTree windowKey="kiko#43" />)

    const list = await vi.waitFor(() => {
      const found = screen.container.querySelector<HTMLElement>(".run-tree-list")
      expect(found).not.toBeNull()
      return found!
    })

    fake.steps = [
      ...fake.steps,
      step("b", { after: 43, startedAt: START + 5_000, status: "running", endedAt: undefined }),
    ]

    await vi.waitFor(() => expect(items(screen.container)).toHaveLength(2))
    expect(screen.container.querySelector(".run-tree-list")).toBe(list)
  })

  it("folds a running helper to one row with the step it is on and a time", async () => {
    using _timers = fakeTimers()
    vi.setSystemTime(START + 5_000)
    const worker = { id: "w1", task: "Food helper" }
    fake.live = true
    fake.steps = [step("look", { after: 33, worker, startedAt: START, status: "running", endedAt: undefined })]
    await using screen = await render(() => <RunTree windowKey="kiko#33" />)

    const helper = rows(screen.container).find((row) => row.dataset.kind === "worker")!
    expect(helper).toBeDefined()
    expect(helper.textContent).toContain("Food helper: Running look")

    const chevron = helper.querySelector(".run-tree-chevron")!
    const meta = helper.querySelector(".run-tree-meta")!
    const order = [...helper.children]
    expect(order.indexOf(chevron)).toBeLessThan(order.indexOf(meta.parentElement!))
    expect(meta.textContent).toBe("5s")

    const clock = screen.container.querySelector(".run-tree-head .run-tree-clock")!
    expect(Math.round(clock.getBoundingClientRect().right)).toBe(Math.round(meta.getBoundingClientRect().right))
  })
})
