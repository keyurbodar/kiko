import { describe, expect, it } from "vitest"
import { routeOf } from "./kiko-remote"
import { serverToolSpecs } from "./server-tools"

const DESKTOP = [
  {
    name: "list_windows",
    description: "list the top-level windows",
    inputSchema: { type: "object", properties: {} },
  },
]

describe("kiko-remote tools", () => {
  it("takes its schemas from the real server extension", () => {
    const names = serverToolSpecs(DESKTOP).map((tool) => tool.name)
    for (const name of [
      "computer_shell",
      "computer_read",
      "computer_write",
      "computer_list",
      "terminal_open",
      "terminal_send",
      "terminal_wait",
      "terminal_read",
      "terminal_list",
      "terminal_close",
      "browser_tabs",
      "browser_read",
      "browser_act",
      "browser_open",
      "browser_close",
      "browser_show",
      "desktop_list_windows",
    ])
      expect(names).toContain(name)
  })

  it("routes every tool the server offers through the Worker", () => {
    const unrouted = serverToolSpecs(DESKTOP)
      .map((tool) => tool.name)
      .filter((name) => routeOf(name) === undefined)
    expect(unrouted).toEqual([])
  })

  it("maps each family to its real op", () => {
    expect(routeOf("computer_shell")).toEqual({ kind: "op", op: "shell" })
    expect(routeOf("terminal_wait")).toEqual({ kind: "op", op: "terminal_wait" })
    expect(routeOf("desktop_get_window_state")).toEqual({ kind: "driver", method: "desktop.call" })
    expect(routeOf("browser_act")).toEqual({ kind: "driver", method: "browser.act" })
    expect(routeOf("computer_list")).toEqual({ kind: "local" })
    expect(routeOf("computer_link")).toBeUndefined()
  })
})
