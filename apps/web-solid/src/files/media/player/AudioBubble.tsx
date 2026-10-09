import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { PauseIcon, PlayIcon } from "@kiko/ui/icons"
import { formatTime, playback, waveformBars } from "./playback"

const BARS = 40

/**
 * A voice or audio message: play, a scrubber and the time. When the server
 * supplies a waveform (`waveform`, one byte per sample) the scrubber is drawn as
 * bars, otherwise as a plain track. No motion: the fill follows the playhead and
 * nothing eases.
 */
export function AudioBubble(props: {
  src: string
  title: string
  artist?: string
  /** Known length in seconds, shown until the file reports its own. */
  duration?: number
  waveform?: ArrayLike<number>
}): JSX.Element {
  let audio!: HTMLAudioElement
  const [playing, setPlaying] = createSignal(false)
  const [time, setTime] = createSignal(0)
  const [length, setLength] = createSignal(props.duration ?? 0)
  const progress = () => (length() ? Math.min(1, time() / length()) : 0)
  const bars = createMemo(() => (props.waveform ? waveformBars(props.waveform, BARS) : null))

  onMount(() => {
    onCleanup(playback.attach(audio, { title: props.title, artist: props.artist }))
  })

  const toggle = () => (audio.paused ? void playback.play(audio) : audio.pause())
  const seekFrom = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (length()) audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * length()
  }
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 5 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -5 : 0
    if (!step) return
    e.preventDefault()
    audio.currentTime = Math.max(0, Math.min(length(), audio.currentTime + step))
  }

  return (
    <div
      data-component="audio-bubble"
      style={{ display: "flex", "align-items": "center", gap: "10px", padding: "6px 4px", "min-width": "220px" }}
    >
      <audio
        ref={audio}
        src={props.src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setTime(audio.currentTime)}
        onLoadedMetadata={() => Number.isFinite(audio.duration) && setLength(audio.duration)}
      />
      <button
        type="button"
        aria-label={playing() ? "Pause" : "Play"}
        onClick={toggle}
        style={{
          width: "40px",
          height: "40px",
          "flex-shrink": 0,
          "border-radius": "50%",
          background: "var(--accent)",
          color: "var(--on-accent)",
          display: "grid",
          "place-items": "center",
        }}
      >
        <Show when={playing()} fallback={<HugeIcon icon={PlayIcon} size={18} fill="currentColor" />}>
          <HugeIcon icon={PauseIcon} size={18} fill="currentColor" />
        </Show>
      </button>
      <div style={{ flex: "1", "min-width": "0", display: "flex", "flex-direction": "column", gap: "4px" }}>
        <div
          role="slider"
          tabindex="0"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(length())}
          aria-valuenow={Math.round(time())}
          aria-valuetext={`${formatTime(time())} of ${formatTime(length())}`}
          data-component="audio-scrubber"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            seekFrom(e)
          }}
          onPointerMove={(e) => e.buttons && seekFrom(e)}
          onKeyDown={onKey}
          style={{
            height: "28px",
            display: "flex",
            "align-items": "center",
            gap: "2px",
            cursor: "pointer",
            position: "relative",
            "touch-action": "none",
          }}
        >
          <Show
            when={bars()}
            fallback={
              <div style={{ flex: "1", height: "4px", "border-radius": "2px", background: "var(--text-wash)", overflow: "hidden" }}>
                <div style={{ width: `${progress() * 100}%`, height: "100%", background: "var(--accent)" }} />
              </div>
            }
          >
            <For each={bars()!}>
              {(v, i) => (
                <span
                  data-played={(i() + 0.5) / BARS <= progress()}
                  style={{
                    flex: "1",
                    height: `${Math.max(12, v * 100)}%`,
                    "border-radius": "1px",
                    background: (i() + 0.5) / BARS <= progress() ? "var(--accent)" : "var(--text-faint)",
                  }}
                />
              )}
            </For>
          </Show>
        </div>
        <span style={{ "font-size": "12px", color: "var(--text-muted)", "font-variant-numeric": "tabular-nums" }}>
          {playing() || time() > 0 ? formatTime(time()) : formatTime(length())}
        </span>
      </div>
    </div>
  )
}
