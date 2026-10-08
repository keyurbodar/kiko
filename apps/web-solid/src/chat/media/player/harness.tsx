// Player harness. Two generated tones, so a browser can play, scrub and see the
// first stop when the second starts. The player is imported lazily, which is
// how a media bubble loads it (tier 3).

import { createSignal, lazy, Suspense } from "solid-js"
import { render } from "solid-js/web"
import "../../../styles/app.css"

function wav(seconds: number, hz: number): string {
  const rate = 8000
  const n = seconds * rate
  const buf = new DataView(new ArrayBuffer(44 + n * 2))
  const s = (o: number, t: string) => [...t].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)))
  s(0, "RIFF")
  buf.setUint32(4, 36 + n * 2, true)
  s(8, "WAVEfmt ")
  buf.setUint32(16, 16, true)
  buf.setUint16(20, 1, true)
  buf.setUint16(22, 1, true)
  buf.setUint32(24, rate, true)
  buf.setUint32(28, rate * 2, true)
  buf.setUint16(32, 2, true)
  buf.setUint16(34, 16, true)
  s(36, "data")
  buf.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) buf.setInt16(44 + i * 2, Math.sin((i / rate) * hz * 2 * Math.PI) * 6000, true)
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }))
}

const AudioBubble = lazy(() => import("./AudioBubble").then((m) => ({ default: m.AudioBubble })))

const FIRST = wav(30, 220)
const SECOND = wav(20, 440)

function Page() {
  const [ready] = createSignal(true)
  const wave = Array.from({ length: 120 }, (_, i) => 40 + Math.abs(Math.sin(i / 5)) * 200)
  return (
    <div style={{ padding: "24px", background: "var(--bg)", "min-height": "100vh", color: "var(--text)", display: "grid", gap: "16px", "max-width": "360px" }}>
      <Suspense>
        {ready() && (
          <>
            <AudioBubble src={FIRST} title="First" duration={30} waveform={wave} />
            <AudioBubble src={SECOND} title="Second" duration={20} />
          </>
        )}
      </Suspense>
    </div>
  )
}

render(() => <Page />, document.getElementById("root") as HTMLElement)
