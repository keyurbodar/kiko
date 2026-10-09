import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { MaximizeIcon, PauseIcon, PlayIcon, VolumeIcon, VolumeOffIcon } from "@kiko/ui/icons"
import { formatTime, playback } from "./playback"

const btn = {
  width: "32px",
  height: "32px",
  display: "grid",
  "place-items": "center",
  color: "inherit",
  "border-radius": "50%",
} as const

/**
 * Video with kiko's own controls: play, scrub, mute and full screen. The
 * controls are plain buttons, so there is nothing to wait on and nothing that
 * animates. Clicking the picture toggles play, as in Telegram.
 */
export function VideoPlayer(props: {
  src: string
  title: string
  poster?: string
  duration?: number
  class?: string
}): JSX.Element {
  let video!: HTMLVideoElement
  let box!: HTMLDivElement
  const [playing, setPlaying] = createSignal(false)
  const [muted, setMuted] = createSignal(false)
  const [time, setTime] = createSignal(0)
  const [length, setLength] = createSignal(props.duration ?? 0)

  onMount(() => onCleanup(playback.attach(video, { title: props.title, artwork: props.poster })))

  const toggle = () => (video.paused ? void playback.play(video) : video.pause())

  return (
    <div
      ref={box}
      data-component="video-player"
      class={props.class}
      style={{ position: "relative", background: "var(--bg-subtle)", overflow: "hidden", "max-width": "100%" }}
    >
      <video
        ref={video}
        src={props.src}
        poster={props.poster}
        playsinline
        preload="metadata"
        aria-label={props.title}
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setTime(video.currentTime)}
        onLoadedMetadata={() => Number.isFinite(video.duration) && setLength(video.duration)}
        onVolumeChange={() => setMuted(video.muted)}
        style={{ display: "block", width: "100%", "max-height": "70vh" }}
      />
      <div
        style={{
          position: "absolute",
          left: "0",
          right: "0",
          bottom: "0",
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "6px 8px",
          background: "oklch(from var(--bg) l c h / 70%)",
          color: "var(--text)",
        }}
      >
        <button type="button" aria-label={playing() ? "Pause" : "Play"} onClick={toggle} style={btn}>
          <Show when={playing()} fallback={<HugeIcon icon={PlayIcon} size={16} fill="currentColor" />}>
            <HugeIcon icon={PauseIcon} size={16} fill="currentColor" />
          </Show>
        </button>
        <span style={{ "font-size": "12px", "font-variant-numeric": "tabular-nums" }}>{formatTime(time())}</span>
        <input
          type="range"
          aria-label="Seek"
          min="0"
          max={length() || 0}
          step="0.1"
          value={time()}
          onInput={(e) => (video.currentTime = Number(e.currentTarget.value))}
          style={{ flex: "1", "min-width": "0", "accent-color": "var(--accent)" }}
        />
        <span style={{ "font-size": "12px", "font-variant-numeric": "tabular-nums" }}>{formatTime(length())}</span>
        <button type="button" aria-label={muted() ? "Unmute" : "Mute"} onClick={() => (video.muted = !video.muted)} style={btn}>
          <Show when={muted()} fallback={<HugeIcon icon={VolumeIcon} size={16} />}>
            <HugeIcon icon={VolumeOffIcon} size={16} />
          </Show>
        </button>
        <button
          type="button"
          aria-label="Full screen"
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen?.())}
          style={btn}
        >
          <HugeIcon icon={MaximizeIcon} size={16} />
        </button>
      </div>
    </div>
  )
}
