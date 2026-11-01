import { assert, describe, it } from "@effect/vitest"
import { capturePlans, captureSize, platform } from "./capture"

const BASE = { ffmpeg: "ffmpeg", fps: 30, quality: 70, encoders: [], format: "mjpeg" as const }

describe("capture size", () => {
  it("keeps a Retina screen at its physical pixels", () => {
    assert.deepStrictEqual(captureSize({ width: 1512, height: 982, scale: 2 }, 2560), { width: 2560, height: 1662 })
  })

  it("does not scale a display that already fits", () => {
    assert.deepStrictEqual(captureSize({ width: 1920, height: 1080, scale: 1 }, 2560), { width: 1920, height: 1080 })
  })

  it("drops resolution, not frame rate, above 2560 pixels", () => {
    assert.deepStrictEqual(captureSize({ width: 3008, height: 1692, scale: 2 }, 2560), { width: 2560, height: 1440 })
  })

  it("respects a narrower cap without stretching", () => {
    assert.deepStrictEqual(captureSize({ width: 3024, height: 1964, scale: 2 }, 1280), { width: 1280, height: 832 })
  })
})

describe("capture plans", () => {
  const screen = { width: 1512, height: 982, scale: 2 }
  const plans = capturePlans({ ...BASE, screen, maxWidth: 2560 })

  it("scales the encoder to the physical size", () => {
    assert.isTrue(plans[0]?.some((arg) => arg.includes("scale=2560:1662")))
  })

  it("asks ffmpeg to draw the real cursor", () => {
    const args = plans[0] ?? []
    if (platform() === "macos") {
      assert.isTrue(args.includes("-capture_cursor"))
      assert.strictEqual(args[args.indexOf("-capture_cursor") + 1], "1")
      return
    }
    const drawn = args.join(" ")
    assert.isTrue(drawn.includes("-draw_mouse 1") || drawn.includes("draw_mouse=1"))
  })

  it("forces a keyframe every second instead of restarting the encoder", () => {
    const keyframes = capturePlans({ ...BASE, screen, maxWidth: 2560, format: "h264" })
    assert.isTrue(keyframes[0]?.includes("-force_key_frames"))
    assert.isTrue(keyframes[0]?.includes("expr:gte(t,n_forced*1)"))
  })
})
