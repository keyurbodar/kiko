import { describe, expect, it, vi } from "vitest"
import { katCommands } from "./kat-commands"

const deps = {
  mac: false,
  toggleSidebar: vi.fn(),
  newChat: vi.fn(),
  closeChat: vi.fn(),
  hasActiveChat: () => true,
  toggleCard: vi.fn(),
  openPanel: vi.fn(),
  copyLink: vi.fn(),
  agentChoices: () => [],
  openView: vi.fn(),
  newGroup: vi.fn(),
  newAgent: vi.fn(),
  openPalette: vi.fn(),
  openChats: vi.fn(),
  fileSearch: () => [],
  chatChoices: () => [],
  reopenClosed: vi.fn(),
  attach: vi.fn(),
  rename: vi.fn(),
  togglePin: vi.fn(),
  deleteChat: vi.fn(),
  goToChat: vi.fn(),
  stepChat: vi.fn(),
  chatCount: () => 2,
  searchChat: vi.fn(),
  canMove: () => true,
}

const command = (id: string) => katCommands(deps).find((entry) => entry.id === id)

describe("chat stepping commands", () => {
  it("stays out of the composer but keeps the shortcuts and the step", () => {
    const previous = command("chats.previous")
    const next = command("chats.next")
    expect(previous?.global).toBeUndefined()
    expect(next?.global).toBeUndefined()
    expect(previous?.shortcut).toBe("Alt+ArrowUp")
    expect(next?.shortcut).toBe("Alt+ArrowDown")
    previous?.run()
    expect(deps.stepChat).toHaveBeenCalledWith(-1)
    next?.run()
    expect(deps.stepChat).toHaveBeenCalledWith(1)
  })

  it("keeps genuinely global commands global", () => {
    expect(command("chats.go")?.global).toBe(true)
    expect(command("palette.open")?.global).toBe(true)
  })
})
