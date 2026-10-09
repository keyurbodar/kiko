/**
 * The one playback controller for the app.
 *
 * Only one item plays at a time: starting a second one pauses the first. The
 * controller owns `navigator.mediaSession`, so the hardware media keys, the
 * lock screen and the keyboard all drive whichever item is current.
 *
 * It also releases decoding. A paused item in a hidden tab drops its source, and
 * gets it back, at the same position, when the tab is visible again.
 *
 * Every dependency is injectable so the rules are testable without a browser.
 */

export interface MediaLike {
  paused: boolean
  currentTime: number
  duration: number
  play(): Promise<void> | void
  pause(): void
  addEventListener(type: string, fn: () => void): void
  removeEventListener(type: string, fn: () => void): void
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  load(): void
}

export interface PlaybackMeta {
  title: string
  artist?: string
  artwork?: string
}

type ActionDetails = { seekTime?: number; seekOffset?: number }

export interface SessionLike {
  metadata: unknown
  playbackState: string
  setActionHandler(action: string, handler: ((d: ActionDetails) => void) | null): void
  setPositionState?(state?: { duration: number; position: number; playbackRate: number }): void
}

export interface PlaybackDeps {
  session?: SessionLike | null
  makeMetadata?: (meta: PlaybackMeta) => unknown
  isHidden?: () => boolean
  onVisibility?: (fn: () => void) => () => void
}

const SEEK_STEP = 10

export function createPlaybackController(deps: PlaybackDeps = {}) {
  const session =
    deps.session === undefined
      ? typeof navigator !== "undefined" && "mediaSession" in navigator
        ? (navigator.mediaSession as unknown as SessionLike)
        : null
      : deps.session
  const isHidden = deps.isHidden ?? (() => typeof document !== "undefined" && document.visibilityState === "hidden")

  interface Entry {
    el: MediaLike
    meta: PlaybackMeta
    off: () => void
    released?: { src: string; time: number }
  }
  const entries = new Map<MediaLike, Entry>()
  let current: Entry | null = null

  const seekTo = (t: number) => {
    if (current) current.el.currentTime = Math.max(0, Math.min(t, current.el.duration || t))
  }

  function bindSession() {
    if (!session) return
    const h = (a: string, fn: (d: ActionDetails) => void) => {
      try {
        session.setActionHandler(a, fn)
      } catch {
        /* an unsupported action is not an error */
      }
    }
    h("play", () => void current?.el.play())
    h("pause", () => current?.el.pause())
    h("stop", () => current?.el.pause())
    h("seekbackward", (d) => seekTo((current?.el.currentTime ?? 0) - (d.seekOffset ?? SEEK_STEP)))
    h("seekforward", (d) => seekTo((current?.el.currentTime ?? 0) + (d.seekOffset ?? SEEK_STEP)))
    h("seekto", (d) => d.seekTime !== undefined && seekTo(d.seekTime))
  }

  function restore(e: Entry) {
    if (!e.released) return
    const { src, time } = e.released
    e.released = undefined
    e.el.setAttribute("src", src)
    e.el.load()
    e.el.currentTime = time
  }

  function release(e: Entry) {
    if (e.released || !e.el.paused) return
    const src = e.el.getAttribute("src")
    if (!src) return
    e.released = { src, time: e.el.currentTime }
    e.el.removeAttribute("src")
    e.el.load()
  }

  function sweep() {
    for (const e of entries.values()) {
      if (isHidden()) release(e)
      else restore(e)
    }
  }

  const offVisibility =
    deps.onVisibility?.(sweep) ??
    (typeof document !== "undefined"
      ? (() => {
          document.addEventListener("visibilitychange", sweep)
          return () => document.removeEventListener("visibilitychange", sweep)
        })()
      : () => {})

  function sync() {
    if (!session || !current) return
    session.playbackState = current.el.paused ? "paused" : "playing"
    const d = current.el.duration
    if (d && Number.isFinite(d)) {
      try {
        session.setPositionState?.({ duration: d, position: current.el.currentTime, playbackRate: 1 })
      } catch {
        /* position state is advisory */
      }
    }
  }

  return {
    /** Register an element. Returns a function that removes it. */
    attach(el: MediaLike, meta: PlaybackMeta): () => void {
      const entry: Entry = { el, meta, off: () => {} }
      const onPlay = () => {
        if (current && current.el !== el) current.el.pause()
        current = entry
        if (session && deps.makeMetadata) session.metadata = deps.makeMetadata(meta)
        else if (session && typeof MediaMetadata !== "undefined") {
          session.metadata = new MediaMetadata({
            title: meta.title,
            artist: meta.artist ?? "",
            artwork: meta.artwork ? [{ src: meta.artwork }] : [],
          })
        }
        bindSession()
        sync()
      }
      const onPause = () => {
        sync()
        if (isHidden()) release(entry)
      }
      const onTime = () => {
        if (current === entry) sync()
      }
      el.addEventListener("play", onPlay)
      el.addEventListener("pause", onPause)
      el.addEventListener("ended", onPause)
      el.addEventListener("timeupdate", onTime)
      entry.off = () => {
        el.removeEventListener("play", onPlay)
        el.removeEventListener("pause", onPause)
        el.removeEventListener("ended", onPause)
        el.removeEventListener("timeupdate", onTime)
      }
      entries.set(el, entry)
      return () => {
        entry.off()
        entries.delete(el)
        if (current === entry) current = null
      }
    },
    /** Play an element, going through the one-at-a-time rule. */
    play(el: MediaLike) {
      const e = entries.get(el)
      if (e) restore(e)
      if (current && current.el !== el) current.el.pause()
      return el.play()
    },
    current: () => current?.el ?? null,
    dispose() {
      offVisibility()
      for (const e of entries.values()) e.off()
      entries.clear()
      current = null
    },
  }
}

export const playback = createPlaybackController()

/** Seconds as `m:ss`, or `h:mm:ss` from an hour. */
export function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0
  const t = Math.floor(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

/**
 * Reduce the server's waveform (one byte per sample, 0 to 255) to `count` bars
 * in 0..1, taking the peak of each bucket.
 */
export function waveformBars(samples: ArrayLike<number>, count: number): number[] {
  if (count <= 0 || samples.length === 0) return []
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * samples.length) / count)
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / count))
    let peak = 0
    for (let j = from; j < to && j < samples.length; j++) peak = Math.max(peak, samples[j] ?? 0)
    out.push(Math.min(1, peak / 255))
  }
  return out
}
