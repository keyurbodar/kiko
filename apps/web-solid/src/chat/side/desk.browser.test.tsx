import type { FileRef, HumanAsk, LifeLine, Task } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { render } from "../../../test/render"
import type { HelperLane } from "../helpers/helper-model"
import { Files, Helpers, Now, Tasks, Used, Waiting } from "./desk-sections"
import { closeAll, deskView, openFiles } from "./surfaces"

const CHAT = "01900000-0000-7000-8000-0000000000bb"

const files = ["trip.pdf", "budget.xlsx", "a.png", "b.png", "c.png", "d.png"].map((name, i) => ({
  id: `f${i}`,
  name,
  size: 10,
  type: "",
})) as FileRef[]

describe("desk card", () => {
  it("shows the newest file tiles and opens the full list from the overflow tile", async () => {
    closeAll(CHAT)
    await using screen = await render(() => <Files files={files} chatId={CHAT} />)
    await expect.element(screen.getByRole("button", { name: "d.png" })).toBeVisible()
    await expect.element(screen.getByRole("button", { name: "trip.pdf" })).not.toBeInTheDocument()
    await screen.getByRole("button", { name: "2 more files" }).click()
    expect(deskView(CHAT)?.id).toBe("files")
    expect(openFiles(CHAT)).toEqual([])
    closeAll(CHAT)
  })

  it("opens a file tile in the panel", async () => {
    closeAll(CHAT)
    await using screen = await render(() => <Files files={files} chatId={CHAT} />)
    await screen.getByRole("button", { name: "d.png" }).click()
    expect(openFiles(CHAT).map((surface) => surface.id)).toEqual(["file:d.png"])
    expect(deskView(CHAT)?.id).toBe("file:d.png")
    closeAll(CHAT)
  })

  it("shows task progress as n of m and the running task first", async () => {
    const tasks = [
      { id: "1", title: "Calendars", status: "done", dependsOn: [] },
      { id: "2", title: "Trains", status: "doing", dependsOn: [] },
      { id: "3", title: "Restaurants", status: "todo", dependsOn: [] },
    ] as unknown as Task[]
    await using screen = await render(() => <Tasks tasks={tasks} chatId={CHAT} />)
    await expect.element(screen.getByRole("button", { name: "Open Tasks" })).toHaveTextContent("Tasks1 of 3")
    const rows = screen.container.querySelectorAll('[data-component="card-task"]')
    expect([...rows].map((row) => row.getAttribute("data-status"))).toEqual(["doing", "todo", "done"])
  })

  it("asks the owner with choices, or points to the composer when it is a form", async () => {
    const asks = [
      { id: "a", from: "kiko", text: "Book Asakusa View?", options: ["Approve", "Skip"] },
      { id: "b", from: "kiko", text: "Which dates?" },
    ] as unknown as HumanAsk[]
    await using screen = await render(() => <Waiting asks={asks} chatId={CHAT} />)
    await expect.element(screen.getByText("Book Asakusa View?")).toBeVisible()
    await expect.element(screen.getByRole("button", { name: "Approve" })).toBeVisible()
    await expect.element(screen.getByRole("button", { name: "Skip" })).toBeVisible()
    await expect.element(screen.getByRole("button", { name: "Answer" })).toBeVisible()
  })

  it("shows what the agent is doing now, with a bar only when tasks give real progress", async () => {
    const tasks = [
      { id: "1", title: "Calendars", status: "done", dependsOn: [] },
      { id: "2", title: "Trains", status: "doing", dependsOn: [] },
    ] as unknown as Task[]
    await using screen = await render(() => (
      <>
        <Now line="Reading notes.md" slug="kiko" tasks={[]} />
        <Now line="Thinking" slug="kiko" tasks={tasks} />
      </>
    ))
    await expect.element(screen.getByText("Reading notes.md")).toBeVisible()
    const bars = screen.container.querySelectorAll('[role="progressbar"]')
    expect(bars).toHaveLength(1)
    expect(bars[0]?.getAttribute("aria-valuenow")).toBe("50")
  })

  it("lists helpers by state and opens the peek panel from one", async () => {
    closeAll(CHAT)
    const lane = (id: string, state: HelperLane["state"], title: string): HelperLane => ({
      id,
      slug: "kiko",
      window: "kiko#1",
      task: title,
      title,
      state,
      line: "Reading brief.md",
      startedAt: 1,
      endedAt: state === "working" ? undefined : 2,
      count: 2,
      steps: [],
    })
    const lanes = [lane("w1", "working", "Hero layouts"), lane("w2", "done", "Icon set")]
    await using screen = await render(() => <Helpers lanes={lanes} chatId={CHAT} />)
    expect(screen.getByRole("button", { name: /Hero layouts/ }).element().textContent).toContain("Reading brief.md")
    expect(screen.getByRole("button", { name: /Icon set/ }).element().textContent).toContain("Finished, 2 steps")
    await expect.element(screen.getByText("1 of 2 working")).toBeVisible()
    await screen.getByRole("button", { name: /Icon set/ }).click()
    expect(deskView(CHAT)?.id).toBe("helper:w2")
    closeAll(CHAT)
  })

  it("marks tasks with rings and folds finished tasks into one line", async () => {
    const tasks = [
      { id: "1", title: "Calendars", status: "done", dependsOn: [] },
      { id: "2", title: "Trains", status: "doing", dependsOn: [] },
    ] as unknown as Task[]
    const done = tasks.map((t) => ({ ...t, status: "done" })) as Task[]
    await using screen = await render(() => (
      <>
        <Tasks tasks={tasks} chatId={CHAT} />
        <Tasks tasks={done} chatId={CHAT} fold />
      </>
    ))
    const marks = [...screen.container.querySelectorAll('[data-component="card-task"]')].map((row) =>
      row.getAttribute("data-mark"),
    )
    expect(marks).toEqual(["doing", "done"])
    await expect.element(screen.getByRole("button", { name: "All 2 tasks done" })).toBeVisible()
  })

  it("shows what the chat used, naming the remembered facts", async () => {
    closeAll(CHAT)
    const lines = [{ pos: 1, at: 0, text: "Window seat", source: "you", pinned: false, redacted: false }] as LifeLine[]
    await using screen = await render(() => <Used files={[]} lines={lines} chatId={CHAT} />)
    expect(screen.getByRole("button", { name: /Memory/ }).element().textContent).toContain("Window seat")
    await screen.getByRole("button", { name: /Memory/ }).click()
    expect(deskView(CHAT)?.id).toBe("memory")
    closeAll(CHAT)
  })
})
