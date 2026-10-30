import type { Task } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import "../../index.css"
import "./cards.css"
import { render } from "../../../test/render"
import { TaskList } from "../../chat/info/task-list"
import { Odometer } from "./odometer"

const task = (id: string, title: string, status: Task["status"], owner?: string): Task => ({
  id,
  title,
  status,
  dependsOn: [],
  ...(owner ? { owner: owner as Task["owner"] } : {}),
})

describe("task rows", () => {
  it("shows status glyphs the owner cannot click, done tasks struck through, and the agent as an avatar", async () => {
    await using screen = await render(() => (
      <TaskList
        tasks={[
          task("a", "Landing copy", "done"),
          task("b", "Email list import", "doing", "kiko"),
          task("c", "Post on X", "todo"),
        ]}
        members={[{ slug: "kiko", name: "Kiko" } as never]}
      />
    ))
    expect(screen.container.querySelectorAll('[role="checkbox"], button')).toHaveLength(0)
    const glyphs = [...screen.container.querySelectorAll<HTMLElement>(".task-glyph")]
    expect(glyphs.map((glyph) => glyph.dataset.status)).toEqual(["done", "doing", "todo"])
    const rows = [...screen.container.querySelectorAll('[data-component="task-step"]')]
    expect(rows[0]?.querySelector("[data-closed]")?.textContent).toBe("Landing copy")
    expect(rows[1]?.querySelector("[data-closed]")).toBeNull()
    expect(rows[1]?.querySelector('[data-component="identity-avatar"]')).not.toBeNull()
    expect(rows[2]?.querySelector('[data-component="identity-avatar"]')).toBeNull()
    expect(rows[1]?.textContent).toContain("now")
  })
})

describe("task rows with details", () => {
  it("keeps a long title on one line in the composer card and hides a finished task's note in the panel", async () => {
    const long = {
      ...task("a", "Landing copy for the new launch page with a long title that wraps", "done", "kiko"),
      note: "Wrote three variants of hero copy and picked the clearest.",
    }
    const doing = { ...task("b", "Email list import", "doing", "kiko"), note: "Importing 4,200 contacts." }
    const members = [{ slug: "kiko", name: "Kiko" } as never]
    await using screen = await render(() => (
      <div style={{ width: "360px" }}>
        <div data-testid="card">
          <TaskList tasks={[long]} members={members} />
        </div>
        <div data-testid="panel">
          <TaskList tasks={[long, doing]} members={members} showDetails />
        </div>
      </div>
    ))
    const title = screen.container.querySelector<HTMLElement>('[data-testid="card"] .task-step-title')!
    expect(title.getBoundingClientRect().height).toBe(20)
    expect(title.title).toBe(long.title)
    const panel = [...screen.container.querySelectorAll('[data-testid="panel"] [data-component="task-step"]')]
    expect(panel[0]?.querySelector(".task-step-detail")).toBeNull()
    expect(panel[1]?.querySelector(".task-step-detail")?.textContent).toBe("Importing 4,200 contacts.")
    const glyph = panel[1]!.querySelector(".task-glyph")!.getBoundingClientRect()
    const firstLine = panel[1]!.querySelector(".task-step-title")!.getBoundingClientRect()
    expect(Math.round(glyph.top - firstLine.top)).toBe(2)
  })
})

describe("odometer", () => {
  it("rolls each digit reel to the current value", async () => {
    const [value, setValue] = createSignal(3)
    await using screen = await render(() => <Odometer value={value()} />)
    const reels = () =>
      [...screen.container.querySelectorAll<HTMLElement>(".odometer-reel")].map((reel) =>
        reel.style.getPropertyValue("--odometer-n"),
      )
    expect(reels()).toEqual(["3"])
    setValue(12)
    await expect.poll(reels).toEqual(["1", "2"])
    expect(screen.container.querySelector(".odometer")?.getAttribute("aria-label")).toBe("12")
  })
})
