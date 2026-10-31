import { describe, expect, it } from "vitest"
import { parseEvents, witness } from "./witness"

type Line = Record<string, unknown>

function text(events: readonly Line[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n")
}

function sample(
  t: number,
  front: "self" | "other",
  key: boolean,
  above: readonly string[],
  pointer: readonly [number, number],
): Line {
  return { ev: "sample", t, front, key, above, pointer }
}

function tick(t: number, received: boolean): Line {
  return { ev: "tick", t, received }
}

const ready: Line = { ev: "ready", t: 0 }

describe("witness", () => {
  it("reports nothing for an idle sentinel", () => {
    const result = witness(
      parseEvents(
        text([
          ready,
          sample(100, "self", true, [], [500, 400]),
          tick(1000, true),
          sample(1100, "self", true, [], [500, 400]),
          tick(2000, true),
          sample(2100, "self", true, [], [500, 400]),
        ]),
      ),
    )
    expect(result.background).toEqual({
      focusSteals: 0,
      pointerMoves: 0,
      keysSwallowed: 0,
      windowsRaised: 0,
    })
    expect(result.keysSent).toBe(2)
    expect(result.keysReceived).toBe(2)
    expect(result.ready).toBe(true)
  })

  it("counts each loss of the frontmost-and-key state once", () => {
    const result = witness(
      parseEvents(
        text([
          ready,
          sample(100, "self", true, [], [0, 0]),
          sample(200, "other", false, [], [0, 0]),
          sample(300, "other", false, [], [0, 0]),
          sample(400, "self", true, [], [0, 0]),
          sample(500, "other", false, [], [0, 0]),
        ]),
      ),
    )
    expect(result.background.focusSteals).toBe(2)
  })

  it("counts losing key status without a front change", () => {
    const result = witness(
      parseEvents(text([ready, sample(100, "self", true, [], [0, 0]), sample(200, "self", false, [], [0, 0])])),
    )
    expect(result.background.focusSteals).toBe(1)
  })

  it("counts windows that appear above the sentinel", () => {
    const result = witness(
      parseEvents(
        text([
          ready,
          sample(100, "self", true, [], [0, 0]),
          sample(200, "self", true, ["Other"], [0, 0]),
          sample(300, "self", true, ["Other"], [0, 0]),
          sample(400, "self", true, ["Other", "Third"], [0, 0]),
          sample(500, "self", true, [], [0, 0]),
          sample(600, "self", true, ["Other"], [0, 0]),
        ]),
      ),
    )
    expect(result.background.windowsRaised).toBe(3)
  })

  it("counts one pointer move per excursion beyond one pixel", () => {
    const result = witness(
      parseEvents(
        text([
          ready,
          sample(100, "self", true, [], [500, 400]),
          sample(200, "self", true, [], [501, 400]),
          sample(300, "self", true, [], [560, 400]),
          sample(400, "self", true, [], [700, 500]),
          sample(500, "self", true, [], [500, 400]),
          sample(600, "self", true, [], [500, 520]),
        ]),
      ),
    )
    expect(result.background.pointerMoves).toBe(2)
  })

  it("counts keys sent but not received", () => {
    const result = witness(parseEvents(text([ready, tick(1000, true), tick(2000, false), tick(3000, false)])))
    expect(result.background.keysSwallowed).toBe(2)
    expect(result.keysSent).toBe(3)
    expect(result.keysReceived).toBe(1)
  })

  it("skips malformed and partial lines", () => {
    const body = [
      JSON.stringify(ready),
      "{not json",
      JSON.stringify({ ev: "sample", t: 100 }),
      JSON.stringify(sample(200, "self", true, [], [0, 0])),
      '{"ev":"tick","t":300,"recei',
    ].join("\n")
    const result = witness(parseEvents(body))
    expect(result.ready).toBe(true)
    expect(result.samples).toBe(1)
    expect(result.keysSent).toBe(0)
  })

  it("surfaces a sentinel error", () => {
    const result = witness(parseEvents(text([{ ev: "error", t: 1, message: "no focus" }])))
    expect(result.error).toBe("no focus")
    expect(result.ready).toBe(false)
  })
})
