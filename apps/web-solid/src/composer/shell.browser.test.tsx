import "../index.css"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { room } from "../state/room"
import { Composer } from "./composer"

const ROOM = "01900000-0000-7000-8000-000000000045"

const SHELL = [
  ".composer-box",
  ".composer-main",
  ".composer-field",
  ".composer-rich",
  '[contenteditable="true"]',
] as const

const EDGELESS = {
  boxShadow: "none",
  borderWidths: ["0px", "0px", "0px", "0px"],
  outlineStyle: "none",
} as const

function edges(element: Element) {
  const style = getComputedStyle(element)
  return {
    boxShadow: style.boxShadow,
    borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
    outlineStyle: style.outlineStyle,
  }
}

function resolvedColor(property: "background" | "color", token: string) {
  const probe = document.createElement("div")
  probe.style.setProperty(property, `var(${token})`)
  document.body.append(probe)
  const value = property === "background" ? getComputedStyle(probe).backgroundColor : getComputedStyle(probe).color
  probe.remove()
  return value
}

function shellParts(root: HTMLElement) {
  return SHELL.map((selector) => root.querySelector<HTMLElement>(selector)!)
}

function expectEdgeless(root: HTMLElement) {
  for (const part of shellParts(root).slice(1)) expect(edges(part)).toEqual(EDGELESS)
}

function border(element: Element) {
  const style = getComputedStyle(element)
  return { width: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor }
}

function inTheme(dark: boolean, check: () => void) {
  const root = document.documentElement
  const before = root.classList.contains("dark")
  root.classList.toggle("dark", dark)
  try {
    check()
  } finally {
    root.classList.toggle("dark", before)
  }
}

describe("composer shell", () => {
  it("reads as an input fill with a quiet hairline that focus strengthens", async () => {
    room.followRoute(() => ROOM)
    await using screen = await render(() => (
      <div class="composer-dock" data-component="composer-dock">
        <Composer threadId={ROOM} bots={[]} onSend={() => {}} />
      </div>
    ))
    await expect.poll(() => screen.container.querySelector('[contenteditable="true"]')).not.toBeNull()
    const box = screen.container.querySelector<HTMLElement>(".composer-box")!
    const input = screen.container.querySelector<HTMLElement>('[contenteditable="true"]')!

    expect(getComputedStyle(box).boxShadow).toBe("none")
    expect(border(box)).toEqual({ width: "1px", style: "solid", color: resolvedColor("color", "--stroke-tertiary") })

    const fills = [true, false].map((dark) => {
      let fill = ""
      inTheme(dark, () => {
        expectEdgeless(screen.container)
        fill = getComputedStyle(box).backgroundColor
        expect(fill).toBe(resolvedColor("background", "--bg-input"))
      })
      return fill
    })
    expect(new Set(fills).size).toBe(2)

    await userEvent.click(input)
    await expect.poll(() => box.hasAttribute("data-focused")).toBe(true)
    expect(document.activeElement).toBe(input)
    await expect.poll(() => border(box).color).toBe(resolvedColor("color", "--stroke-secondary"))
    expect(getComputedStyle(box).outlineStyle).toBe("none")

    box.setAttribute("data-editing", "")
    for (const dark of [true, false]) inTheme(dark, () => expectEdgeless(screen.container))
  })
})
