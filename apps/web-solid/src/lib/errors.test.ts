import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { ToastV2Options } from "@kiko/ui/v2/toast-v2"

const shown: ToastV2Options[] = []
mock.module("@kiko/ui/v2/toast-v2", () => ({ showToastV2: (options: ToastV2Options) => void shown.push(options) }))

const { seenInChat, showKikoError } = await import("./errors")
const { closeSettings, settingsSection } = await import("../settings/dialog-state")

beforeEach(() => {
  shown.length = 0
  closeSettings()
})

describe("showKikoError", () => {
  test("an error with an action stays until dismissed, and the button opens settings on the section that fixes it", () => {
    showKikoError({ code: "composio_rejected", message: "Composio did not accept your key. Check it in integrations.", action: "open_integrations" })
    const toast = shown[0]!
    expect(toast).toMatchObject({ title: "Composio did not accept your key. Check it in integrations.", variant: "error", persistent: true })
    expect(toast.action?.label).toBe("Open settings")
    expect(settingsSection()).toBeNull()
    ;(toast.action!.onClick as () => void)()
    expect(settingsSection()).toBe("tools")
  })

  test("the models action opens settings on models", () => {
    showKikoError({ code: "storage", message: "Kiko could not save that.", action: "open_models" })
    ;(shown[0]!.action!.onClick as () => void)()
    expect(settingsSection()).toBe("models")
  })

  test("an error with nothing to do closes on its own", () => {
    showKikoError({ code: "storage", message: "Kiko could not save that. Try again." })
    expect(shown[0]).toMatchObject({ variant: "error", duration: 10_000 })
    expect(shown[0]!.action).toBeUndefined()
    expect(shown[0]!.persistent).toBeUndefined()
  })

  test("the same error twice is the same toast, which the toaster refreshes instead of stacking", () => {
    const error = { code: "composio_down", message: "Composio is not answering. Your apps are unavailable for now." } as const
    showKikoError(error)
    showKikoError(error)
    const key = (o: ToastV2Options) => JSON.stringify([o.title, o.description, o.variant, o.duration, o.persistent, o.action?.label])
    expect(key(shown[0]!)).toBe(key(shown[1]!))
  })
})

describe("an error the open chat already shows", () => {
  test.each([
    ["r1", "r1", true, true],
    ["r1", "r2", true, false],
    ["r1", "r1", false, false],
    [undefined, "r1", true, false],
    ["r1", null, true, false],
  ])("room %s, open %s, visible %s", (roomId, open, visible, want) => {
    expect(seenInChat(roomId, open, visible)).toBe(want);
  });
});
