import "../../index.css"
import type { Task } from "@kiko/protocol"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../../test/render"
import { fakeTimers } from "../../../test/timers"
import ThreadDetails from "./thread-details"
import { ALL_DONE_MS, FINISH_KEEP_MS } from "./thread-details-model"
import { resetThreadDetails } from "./thread-details-state"

const fake = vi.hoisted(() => ({
  setTasks: null as unknown as (tasks: readonly unknown[]) => void,
  setHelpers: null as unknown as (helpers: readonly unknown[]) => void,
  setPresence: null as unknown as (presence: string) => void,
}))

vi.mock("../../state/room", async () => {
  const { createSignal } = await import("solid-js")
  const [tasks, setTasks] = createSignal<readonly unknown[]>([])
  const [helpers, setHelpers] = createSignal<readonly unknown[]>([])
  const [presence, setPresence] = createSignal("idle")
  fake.setTasks = setTasks as never
  fake.setHelpers = setHelpers as never
  fake.setPresence = setPresence as never
  return {
    fileSrc: () => "",
    room: {
      messages: () => [],
      files: () => [],
      tasks: () => tasks(),
      helpers: () => helpers(),
      typingSlugs: () => [],
      typingDoings: () => [],
      typingRun: () => null,
      runSteps: () => [],
      runReady: () => true,
      chatById: () => ({ presence: presence() }),
      active: () => ({ asks: () => [] }),
      roomMembers: () => [],
      taskOp: () => {},
      messageById: () => undefined,
    },
  }
})

vi.mock("../info/memory/views", () => ({ useMemoryStore: () => () => undefined }))

vi.mock("../../search/state", () => ({ requestJump: () => {} }))

vi.mock("./surfaces", () => ({
  fixedSurface: () => ({}),
  helperSurface: () => ({}),
  openFile: () => {},
  openSurface: () => {},
}))

const CHAT = "01900000-0000-7000-8000-0000000000cc"
const START = 10_000

const task = (id: string, status: Task["status"]): Task => ({ id, status, title: id, dependsOn: [] }) as unknown as Task

const lane = (state: string, endedAt?: number) => ({
  id: "w1",
  slug: "kiko",
  window: "kiko#1",
  task: "hotels",
  title: "compare hotels",
  state,
  line: "Reading",
  startedAt: 1,
  endedAt,
  count: 1,
  steps: [],
})

const section = (host: HTMLElement, id: string) => host.querySelector(`[data-section="${id}"]`)

const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
    (item) => item.textContent?.trim() === label,
  )

describe("thread details card", () => {
  it("counts every finished task and then leaves once they are all done", async () => {
    using _timers = fakeTimers()
    resetThreadDetails()
    fake.setPresence("idle")
    fake.setTasks([task("a", "done"), task("b", "todo")])
    await using screen = await render(() => <ThreadDetails chatId={CHAT} />)
    expect(section(screen.container, "progress")?.textContent).toContain("1 of 2")
    fake.setTasks([task("a", "done"), task("b", "done")])
    await expect.poll(() => section(screen.container, "progress")?.textContent).toContain("All 2 done")
    expect(section(screen.container, "progress")?.querySelector('[data-action="fold-done-tasks"]')).toBeNull()
    vi.advanceTimersByTime(ALL_DONE_MS + 200)
    await expect.poll(() => section(screen.container, "progress")).toBeNull()
  })

  it("leaves progress out when the chat opens with every task already done", async () => {
    using _timers = fakeTimers()
    resetThreadDetails()
    fake.setPresence("idle")
    fake.setTasks([task("a", "done"), task("b", "done")])
    await using screen = await render(() => <ThreadDetails chatId={CHAT} />)
    expect(section(screen.container, "progress")).toBeNull()
  })

  it("keeps a helper briefly when it finishes, then counts it under finished", async () => {
    using _timers = fakeTimers()
    vi.setSystemTime(START)
    resetThreadDetails()
    fake.setPresence("idle")
    fake.setHelpers([lane("working")])
    await using screen = await render(() => <ThreadDetails chatId={CHAT} />)
    const helpers = () => section(screen.container, "helpers")!
    const rows = () => [...helpers().querySelectorAll('[data-action="open-helper"]')]
    const finishedList = () => helpers().querySelector('[data-action="fold-finished-helpers"]')?.nextElementSibling
    const inFinished = (row: Element) => finishedList()?.contains(row) ?? false
    expect(helpers().textContent).toContain("compare hotels")
    expect(rows().some((row) => !inFinished(row))).toBe(true)
    fake.setHelpers([lane("done", START)])
    vi.advanceTimersByTime(FINISH_KEEP_MS - 200)
    expect(helpers().textContent).toContain("1 finished")
    expect(rows().some((row) => !inFinished(row))).toBe(true)
    vi.advanceTimersByTime(FINISH_KEEP_MS)
    expect(rows().length).toBeGreaterThan(0)
    expect(rows().every(inFinished)).toBe(true)
  })

  it("hides a section from the customize menu and remembers it after a reload", async () => {
    resetThreadDetails()
    fake.setPresence("idle")
    fake.setHelpers([lane("working")])
    const first = await render(() => <ThreadDetails chatId={CHAT} />)
    expect(section(first.container, "helpers")).not.toBeNull()
    await userEvent.click(first.container.querySelector('[data-action="customize-details"]') as HTMLElement)
    await vi.waitFor(() => expect(menuItem("Helpers")).toBeDefined())
    await userEvent.click(menuItem("Helpers")!)
    expect(section(first.container, "helpers")).toBeNull()
    expect(JSON.parse(localStorage.getItem("kiko:thread-details:v1") ?? "{}")).toEqual({ helpers: false })
    await first[Symbol.asyncDispose]()
    await using second = await render(() => <ThreadDetails chatId={CHAT} />)
    expect(section(second.container, "helpers")).toBeNull()
    resetThreadDetails()
  })

  it("keeps the customize menu under its button while sections are hidden", async () => {
    resetThreadDetails()
    fake.setPresence("idle")
    fake.setTasks([task("a", "todo")])
    fake.setHelpers([lane("working")])
    await using screen = await render(() => <ThreadDetails chatId={CHAT} />)
    const button = screen.container.querySelector<HTMLElement>('[data-action="customize-details"]')!
    await userEvent.click(button)
    await vi.waitFor(() => expect(menuItem("Progress")).toBeDefined())
    const menu = () => document.querySelector<HTMLElement>('[role="menu"]')!
    await Promise.all(
      menu()
        .getAnimations()
        .map((animation) => animation.finished),
    )
    const before = menu().getBoundingClientRect()
    const gear = button.getBoundingClientRect()
    expect(before.top).toBeGreaterThanOrEqual(gear.bottom)
    expect(Math.abs(before.right - gear.right)).toBeLessThan(2)

    await userEvent.click(menuItem("Progress")!)
    expect(section(screen.container, "progress")).toBeNull()
    const after = menu().getBoundingClientRect()
    expect(after.top).toBe(before.top)
    expect(after.right).toBe(before.right)
    expect(menuItem("Progress")?.getAttribute("aria-checked")).toBe("false")
    resetThreadDetails()
  })

  it("shows one row to reopen the menu when every section is hidden", async () => {
    resetThreadDetails()
    fake.setPresence("idle")
    fake.setHelpers([])
    fake.setTasks([])
    await using screen = await render(() => <ThreadDetails chatId={CHAT} />)
    expect(screen.container.textContent).toContain("Choose what to show")
  })
})
