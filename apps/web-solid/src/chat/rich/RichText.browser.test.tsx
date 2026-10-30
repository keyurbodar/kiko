import "../../index.css"
import { describe, expect, it } from "vitest"
import { parseRichText } from "@kiko/protocol/markdown"
import { render } from "../../../test/render"
import { RichText } from "./RichText"

const FOUR = `I compared four hotels near the ferry.

| Hotel | Area | Price | Notes |
| --- | --- | --- | --- |
| Harbor House | Old town | $180 | Two minutes from the ferry, quiet rooms, and breakfast included every morning |
| Station Inn | North gate | $120 | Steps from the platform, but the street outside stays loud until midnight |
| Garden Court | Riverside | $150 | A long walk with bags, a calm courtyard, and no breakfast before eight |
| Pier Lodge | Harbour | $165 | Rooms face the water, and the bar downstairs closes at one on weekends |`

const NINE = `Nine columns of the same ferry timetable.

| Line | Departs | Arrives | Duration | Vessel | Seats | Bike | Cafe | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| North | 06:40 | 07:25 | 45m | Aurora | 240 | 12 | yes | Quiet crossing, usually on time |
| South | 07:10 | 08:05 | 55m | Ferry McFerryface | 180 | 8 | no | Long queue for cars at peak |`

const mount = (markdown: string, width: number) =>
  render(() => (
    <div style={{ width: `${width}px` }}>
      <RichText tree={parseRichText(markdown)} />
    </div>
  ))

const scroller = (container: HTMLElement) => container.querySelector<HTMLElement>(".rich-table-scroll")!

describe("RichText tables", () => {
  it("wraps a four-column table with a long column inside its bubble", async () => {
    await using screen = await mount(FOUR, 412)
    const scroll = scroller(screen.container)

    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth)
    for (const cell of screen.container.querySelectorAll<HTMLElement>("tbody td")) {
      expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth)
    }
  })

  it("scrolls a nine-column table and reports both edge fades", async () => {
    await using screen = await mount(NINE, 412)
    const scroll = scroller(screen.container)

    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)
    expect(scroll.style.getPropertyValue("--overflow-start")).toBe("0px")
    expect(Number.parseFloat(scroll.style.getPropertyValue("--overflow-end"))).toBeGreaterThan(0)

    scroll.scrollLeft = 40
    scroll.dispatchEvent(new Event("scroll"))

    expect(scroll.style.getPropertyValue("--overflow-start")).toBe("40px")
  })
})
