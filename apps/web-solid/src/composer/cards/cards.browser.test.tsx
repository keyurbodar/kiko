import type { Task } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { render } from "../../../test/render"
import { TaskList } from "../../chat/info/task-list"
import { Odometer } from "./odometer"

const task = (id: string, title: string, status: Task["status"], owner?: string): Task => ({
  id,
  title,
  status,
  dependsOn: [],
  ...(owner ? { owner } : {}),
})

describe("task rows", () => {
  it("shows done tasks ticked and struck through, open tasks as empty boxes, and the agent as an avatar", async () => {
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
    const boxes = [...screen.container.querySelectorAll<HTMLElement>('[role="checkbox"]')]
    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["true", "false", "false"])
    const rows = [...screen.container.querySelectorAll('[data-component="task-step"]')]
    expect(rows[0]?.querySelector("[data-closed]")?.textContent).toBe("Landing copy")
    expect(rows[1]?.querySelector("[data-closed]")).toBeNull()
    expect(rows[1]?.querySelector('[data-component="identity-avatar"]')).not.toBeNull()
    expect(rows[2]?.querySelector('[data-component="identity-avatar"]')).toBeNull()
    expect(rows[1]?.textContent).toContain("now")
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
