import { describe, expect, it } from "vitest"
import { arriveLine, hideLine, openLine, sendLine, showLine, type Said } from "./unread-line"

const human = (seq: number, at = seq): Said => ({ id: `h${seq}`, seq, at, agent: false })
const agent = (seq: number, at = seq): Said => ({ id: `a${seq}`, seq, at, agent: true })

describe("unread line", () => {
  it("opens above the first agent message after the read mark", () => {
    const messages = [human(1), agent(2), human(3), agent(4), agent(5)]
    expect(openLine(messages, 3, false).anchor).toBe("a4")
    expect(openLine(messages, 5, false).anchor).toBeNull()
  })

  it("marks replies that land while the tab is hidden", () => {
    const before = [human(1), agent(2)]
    let line = openLine(before, 2, false)
    expect(line.anchor).toBeNull()
    line = hideLine(line, before)
    const after = [...before, agent(3), agent(4)]
    line = arriveLine(line, after)
    expect(line.anchor).toBe("a3")
    line = showLine(line, 10)
    expect(arriveLine(line, [...after, agent(5)]).anchor).toBe("a3")
  })

  it("marks replies written while hidden that only reach the tab after the owner returns", () => {
    const before = [human(1), agent(2)]
    let line = hideLine(openLine(before, 2, false), before)
    line = showLine(line, 100)
    line = arriveLine(line, [...before, agent(3, 50)])
    expect(line.anchor).toBe("a3")
  })

  it("stays gone after the owner replies to what landed while away", () => {
    const before = [human(1), agent(2)]
    let line = hideLine(openLine(before, 2, false), before)
    const away = [...before, agent(3, 50)]
    line = showLine(arriveLine(line, away), 100)
    expect(line.anchor).toBe("a3")
    line = sendLine(line)
    line = arriveLine(line, [...away, human(4, 120)])
    expect(line.anchor).toBeNull()
  })

  it("ignores replies written after the owner returns", () => {
    const before = [human(1), agent(2)]
    let line = hideLine(openLine(before, 2, false), before)
    line = showLine(line, 100)
    line = arriveLine(line, [...before, agent(3, 150)])
    expect(line.anchor).toBeNull()
  })

  it("ignores replies that land while the owner is watching", () => {
    const before = [human(1), agent(2)]
    const line = arriveLine(openLine(before, 2, false), [...before, human(3), agent(4)])
    expect(line.anchor).toBeNull()
  })

  it("ignores the owner's own messages sent while hidden", () => {
    const before = [agent(1)]
    const line = arriveLine(hideLine(openLine(before, 1, false), before), [...before, human(2)])
    expect(line.anchor).toBeNull()
  })

  it("keeps the first unread when more replies land while hidden again", () => {
    const messages = [human(1), agent(2), agent(3)]
    let line = openLine(messages, 1, false)
    line = hideLine(line, messages)
    line = arriveLine(line, [...messages, agent(4)])
    expect(line.anchor).toBe("a2")
  })

  it("marks replies when the chat opens in a hidden tab", () => {
    const before = [human(1), agent(2)]
    const line = arriveLine(openLine(before, 2, true), [...before, agent(3)])
    expect(line.anchor).toBe("a3")
  })

  it("clears after the owner sends, and starts again from the next time away", () => {
    const messages = [human(1), agent(2)]
    let line = openLine(messages, 1, false)
    expect(line.anchor).toBe("a2")
    line = sendLine(line)
    expect(line.anchor).toBeNull()
    const sent = [...messages, human(3), agent(4)]
    line = arriveLine(line, sent)
    expect(line.anchor).toBeNull()
    line = hideLine(line, sent)
    line = arriveLine(line, [...sent, agent(5)])
    expect(line.anchor).toBe("a5")
  })
})
