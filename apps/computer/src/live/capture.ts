export type Platform = "macos" | "linux" | "windows"

export function platform(): Platform {
  if (process.platform === "darwin") return "macos"
  if (process.platform === "win32") return "windows"
  return "linux"
}

const MAX_LONG_EDGE = 1920
const KEYFRAME_SECONDS = 2
const VAAPI_DEVICE = "/dev/dri/renderD128"

export type Screen = { width: number; height: number; originX?: number; originY?: number }

export type CaptureOptions = {
  ffmpeg: string
  screen: Screen
  format: "h264" | "mjpeg"
  fps: number
  maxWidth: number
  quality: number
  encoders: readonly string[]
  screenIndex?: number
}

type Encoder = { name: string; args: readonly string[] }

const HARDWARE: readonly Encoder[] = [
  { name: "h264_videotoolbox", args: ["-realtime", "true", "-allow_sw", "1"] },
  { name: "h264_nvenc", args: ["-preset", "p1", "-tune", "ull", "-zerolatency", "1"] },
  { name: "h264_qsv", args: ["-preset", "veryfast", "-low_power", "1"] },
  { name: "h264_mf", args: ["-scenario", "display_remoting"] },
  { name: "h264_vaapi", args: [] },
]

const SOFTWARE: readonly string[] = ["libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-bf", "0"]

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

function scaled(screen: Screen, maxWidth: number): { width: number; height: number } {
  const limit = Math.min(MAX_LONG_EDGE, maxWidth > 0 ? maxWidth : MAX_LONG_EDGE)
  const long = Math.max(screen.width, screen.height)
  const ratio = long > limit ? limit / long : 1
  return { width: even(screen.width * ratio), height: even(screen.height * ratio) }
}

function quality(level: number): string {
  return String(Math.round(31 - (Math.min(100, Math.max(1, level)) / 100) * 19))
}

function linuxSources(screen: Screen, fps: number): string[][] {
  const region = `${screen.originX ?? 0},${screen.originY ?? 0},${screen.width || 1},${screen.height || 1}`
  return [
    ["-f", "x11grab", "-draw_mouse", "0", "-framerate", String(fps), "-i", `${process.env.DISPLAY ?? ":0"}+${region}`],
  ]
}

function macSources(fps: number, index: number): string[][] {
  return [["-f", "avfoundation", "-capture_cursor", "0", "-framerate", String(fps), "-i", `${index}:none`]]
}

function windowsSources(screen: Screen, fps: number): string[][] {
  const offset = `:offset_x=${screen.originX ?? 0}:offset_y=${screen.originY ?? 0}`
  return [
    ["-f", "lavfi", "-i", `ddagrab=output_idx=0:framerate=${fps}:draw_mouse=0`],
    ["-f", "lavfi", "-i", `ddagrab=output_idx=0:framerate=${fps}:draw_mouse=0${offset}`],
    ["-f", "gdigrab", "-draw_mouse", "0", "-framerate", String(fps), "-i", "desktop"],
  ]
}

function sources(options: CaptureOptions): string[][] {
  const name = platform()
  if (name === "macos") return macSources(options.fps, options.screenIndex ?? 1)
  if (name === "windows") return windowsSources(options.screen, options.fps)
  return linuxSources(options.screen, options.fps)
}

function videoEncoders(options: CaptureOptions): Encoder[] {
  if (options.format === "mjpeg") return [{ name: "mjpeg", args: ["-c:v", "mjpeg", "-q:v", quality(options.quality)] }]
  const gop = ["-g", String(Math.max(2, Math.round(options.fps * KEYFRAME_SECONDS)))]
  const force = ["-force_key_frames", `expr:gte(t,n_forced*${KEYFRAME_SECONDS})`]
  const hardware = HARDWARE.filter(({ name }) => options.encoders.includes(name)).map(({ name, args }) => ({
    name,
    args: ["-c:v", name, ...args, ...gop, ...force],
  }))
  return [...hardware, { name: "libx264", args: ["-c:v", ...SOFTWARE, ...gop, ...force] }]
}

function inputFilter(options: CaptureOptions, encoder: string): string[] {
  const size = scaled(options.screen, options.maxWidth)
  const scale = `scale=${size.width}:${size.height}:flags=fast_bilinear`
  return ["-vf", encoder === "h264_vaapi" ? `${scale},format=nv12,hwupload` : scale]
}

export function capturePlans(options: CaptureOptions): string[][] {
  const output = ["-f", options.format === "h264" ? "h264" : "mjpeg", "pipe:1"]
  const head = [options.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin"]
  const fixed = ["-r", String(options.fps), "-an"]
  return sources(options).flatMap((source) =>
    videoEncoders(options).map((encoder) => [
      ...head,
      ...(encoder.name === "h264_vaapi" ? ["-vaapi_device", VAAPI_DEVICE] : []),
      ...source,
      ...fixed,
      ...inputFilter(options, encoder.name),
      ...encoder.args,
      ...output,
    ]),
  )
}

const HARDWARE_ORDER = HARDWARE.map(({ name }) => name)

export function orderEncoders(available: readonly string[]): string[] {
  return HARDWARE_ORDER.filter((name) => available.includes(name))
}
