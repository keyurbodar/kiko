import { describe, expect, test } from "bun:test"
import { createPlaybackController, formatTime, waveformBars, type MediaLike, type SessionLike } from "./playback"

function fake(src = "a.mp3") {
  const l = new Map<string, Set<() => void>>()
  const attrs: Record<string, string> = { src }
  const el = {
    paused: true,
    currentTime: 0,
    duration: 100,
    attrs,
    play() {
      el.paused = false
      el.fire("play")
    },
    pause() {
      if (!el.paused) {
        el.paused = true
        el.fire("pause")
      }
    },
    addEventListener(t: string, f: () => void) {
      if (!l.has(t)) l.set(t, new Set())
      l.get(t)!.add(f)
    },
    removeEventListener(t: string, f: () => void) {
      l.get(t)?.delete(f)
    },
    getAttribute: (n: string) => attrs[n] ?? null,
    setAttribute: (n: string, v: string) => void (attrs[n] = v),
    removeAttribute: (n: string) => void delete attrs[n],
    load() {},
    fire(t: string) {
      l.get(t)?.forEach((f) => f())
    },
  }
  return el satisfies MediaLike & { fire(t: string): void }
}

function setup() {
  const hidden = { v: false }
  const handlers: Record<string, (d: { seekTime?: number; seekOffset?: number }) => void> = {}
  let vis = () => {}
  const session: SessionLike = {
    metadata: null,
    playbackState: "none",
    setActionHandler: (a, h) => void (handlers[a] = h!),
  }
  const c = createPlaybackController({
    session,
    makeMetadata: (m) => m,
    isHidden: () => hidden.v,
    onVisibility: (f) => ((vis = f), () => {}),
  })
  return {
    c,
    session,
    handlers,
    hide: () => ((hidden.v = true), vis()),
    show: () => ((hidden.v = false), vis()),
  }
}

describe("playback controller", () => {
  test("starting a second item stops the first", () => {
    const { c } = setup()
    const a = fake()
    const b = fake("b.mp3")
    c.attach(a, { title: "a" })
    c.attach(b, { title: "b" })
    c.play(a)
    expect(a.paused).toBe(false)
    c.play(b)
    expect(a.paused).toBe(true)
    expect(b.paused).toBe(false)
    expect(c.current()).toBe(b)
  })
  test("a native play event also stops the other", () => {
    const { c } = setup()
    const a = fake()
    const b = fake()
    c.attach(a, { title: "a" })
    c.attach(b, { title: "b" })
    a.play()
    b.play()
    expect(a.paused).toBe(true)
  })
  test("media session metadata and handlers drive the current item", () => {
    const { c, session, handlers } = setup()
    const a = fake()
    c.attach(a, { title: "song" })
    a.play()
    expect(session.metadata).toEqual({ title: "song" })
    expect(session.playbackState).toBe("playing")
    handlers.pause!({})
    expect(a.paused).toBe(true)
    handlers.play!({})
    expect(a.paused).toBe(false)
    a.currentTime = 20
    handlers.seekforward!({})
    expect(a.currentTime).toBe(30)
    handlers.seekbackward!({ seekOffset: 5 })
    expect(a.currentTime).toBe(25)
    handlers.seekto!({ seekTime: 7 })
    expect(a.currentTime).toBe(7)
  })
  test("a paused item drops its source while hidden and gets it back", () => {
    const { c, hide, show } = setup()
    const a = fake("a.mp3")
    const b = fake("b.mp3")
    c.attach(a, { title: "a" })
    c.attach(b, { title: "b" })
    a.play()
    a.currentTime = 12
    hide()
    expect(a.attrs.src).toBe("a.mp3")
    expect(b.attrs.src).toBeUndefined()
    a.pause()
    expect(a.attrs.src).toBeUndefined()
    show()
    expect(a.attrs.src).toBe("a.mp3")
    expect(a.currentTime).toBe(12)
    expect(b.attrs.src).toBe("b.mp3")
  })
})

test("formatTime", () => {
  expect(formatTime(0)).toBe("0:00")
  expect(formatTime(65.9)).toBe("1:05")
  expect(formatTime(3725)).toBe("1:02:05")
  expect(formatTime(NaN)).toBe("0:00")
})
test("waveformBars takes bucket peaks", () => {
  expect(waveformBars([0, 255, 51, 51], 2)).toEqual([1, 0.2])
  expect(waveformBars([], 4)).toEqual([])
})
