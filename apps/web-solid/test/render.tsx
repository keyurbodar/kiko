import { render as mount } from "@solidjs/testing-library"
import type { JSX } from "solid-js"
import { type Locator, type LocatorSelectors, page, utils } from "vitest/browser"

export type RenderOptions = {
  readonly container?: HTMLElement
  readonly location?: string
}

export type Screen = LocatorSelectors &
  AsyncDisposable & {
    readonly container: HTMLElement
    readonly locator: Locator
    readonly unmount: () => void
  }

export async function render(
  ui: () => JSX.Element,
  { container = document.createElement("div"), location }: RenderOptions = {},
): Promise<Screen> {
  if (!container.isConnected) document.body.append(container)
  let mounted = false
  let unmountTree = () => {}
  const unmount = () => {
    if (!mounted) return
    mounted = false
    unmountTree()
  }
  const screen: Screen = {
    ...utils.getElementLocatorSelectors(container),
    container,
    locator: page.elementLocator(container),
    unmount,
    async [Symbol.asyncDispose]() {
      try {
        unmount()
      } finally {
        container.remove()
      }
    },
  }
  try {
    unmountTree = mount(ui, { container, ...(location === undefined ? {} : { location }) }).unmount
    mounted = true
  } catch (error) {
    await screen[Symbol.asyncDispose]()
    throw error
  }
  return screen
}
