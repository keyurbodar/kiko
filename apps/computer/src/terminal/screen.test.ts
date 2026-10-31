import { describe, expect, it } from "@effect/vitest"
import { createScreen } from "./screen"

const feed = (screen: ReturnType<typeof createScreen>, text: string) =>
  new Promise<void>((done) => screen.write(text, done))

describe("createScreen", () => {
  it("returns the visible lines as text", async () => {
    const screen = createScreen(40, 6, () => {})
    await feed(screen, "hello\r\nworld\r\n")

    expect(screen.text()).toBe("hello\nworld")
    screen.dispose()
  })

  it("returns the alternate screen of a full-screen app", async () => {
    const screen = createScreen(40, 6, () => {})
    await feed(screen, "\x1b[?1049h\x1b[2J\x1b[Hkiko terminal screen\r\nsecond line")

    expect(screen.text()).toBe("kiko terminal screen\nsecond line")
    screen.dispose()
  })

  it("draws at the cursor position", async () => {
    const screen = createScreen(40, 6, () => {})
    await feed(screen, "\x1b[2;3Hmiddle")

    expect(screen.text()).toBe("  middle")
    screen.dispose()
  })

  it("answers a device attributes query", async () => {
    const replies: string[] = []
    const screen = createScreen(40, 6, (data) => replies.push(data))
    await feed(screen, "\x1b[c")

    expect(replies.join("")).toContain("\x1b[?")
    screen.dispose()
  })
})
