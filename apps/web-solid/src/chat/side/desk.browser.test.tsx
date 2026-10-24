import type { FileRef, HumanAsk, LifeLine, Task, WorkerRow } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { render } from "../../../test/render"
import { Files, Helpers, Memory, Now, Tasks, Waiting } from "./desk-sections"
import { closeAll, sidecarSurfaces } from "./surfaces"

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
    expect(sidecarSurfaces(CHAT).map((surface) => surface.id)).toEqual(["files"])
    closeAll(CHAT)
  })

  it("opens a file tile as its own surface", async () => {
    closeAll(CHAT)
    await using screen = await render(() => <Files files={files} chatId={CHAT} />)
    await screen.getByRole("button", { name: "d.png" }).click()
    expect(sidecarSurfaces(CHAT).map((surface) => surface.id)).toEqual(["file:d.png"])
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

  it("shows a progress bar for what the agent is doing now", async () => {
    await using screen = await render(() => <Now line="Kiko is reading a file" slug="kiko" tasks={[]} />)
    await expect.element(screen.getByText("Kiko is reading a file")).toBeVisible()
    await expect.element(screen.getByRole("progressbar")).toBeInTheDocument()
  })

  it("lists helpers and memory facts, naming whose memory it is", async () => {
    const workers: WorkerRow[] = [{ id: "w", task: "Flights", status: "done", step: null, steps: 2, startedAt: 1 }]
    const lines = [{ pos: 1, at: 0, text: "Window seat", source: "you", pinned: false, redacted: false }] as LifeLine[]
    await using screen = await render(() => (
      <>
        <Helpers workers={workers} chatId={CHAT} />
        <Memory lines={lines} more={false} whose="Kiko" chatId={CHAT} />
      </>
    ))
    await expect.element(screen.getByText("Flights")).toBeVisible()
    await expect
      .element(screen.getByRole("button", { name: "Open Kiko knows here" }))
      .toHaveTextContent("Kiko knows here1")
    await expect.element(screen.getByRole("button", { name: "Window seat" })).toBeVisible()
  })
})
