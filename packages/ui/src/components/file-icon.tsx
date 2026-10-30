import type { Component, JSX } from "solid-js"
import { createEffect, createMemo, splitProps } from "solid-js"
import { glyphNodes } from "./glyph-cache"

type Tone = readonly [light: string, dark: string]

const BLUE: Tone = ["#3b7ff0", "#78aaff"]
const ORANGE: Tone = ["#e0701a", "#ff9d52"]
const GREEN: Tone = ["#1c9a52", "#52d08a"]
const RED: Tone = ["#e0474c", "#ff7676"]
const PURPLE: Tone = ["#8656f0", "#b997ff"]
const YELLOW: Tone = ["#b98f00", "#ffd24f"]
const TEAL: Tone = ["#0e9aa4", "#52d0da"]
const GREY: Tone = ["#6f7480", "#9ea3ae"]

type Badge = { label: string; tone: Tone }

const badge = (label: string, tone: Tone): Badge => ({ label, tone })

const EXTENSIONS: Record<string, Badge> = {
  md: badge("MD", BLUE),
  mdx: badge("MDX", BLUE),
  html: badge("HTML", ORANGE),
  htm: badge("HTML", ORANGE),
  xls: badge("XLS", GREEN),
  xlsx: badge("XLS", GREEN),
  ods: badge("XLS", GREEN),
  numbers: badge("XLS", GREEN),
  csv: badge("CSV", GREEN),
  tsv: badge("TSV", GREEN),
  pdf: badge("PDF", RED),
  jpg: badge("JPG", PURPLE),
  jpeg: badge("JPG", PURPLE),
  png: badge("PNG", PURPLE),
  gif: badge("GIF", PURPLE),
  webp: badge("IMG", PURPLE),
  heic: badge("IMG", PURPLE),
  avif: badge("IMG", PURPLE),
  bmp: badge("IMG", PURPLE),
  svg: badge("SVG", PURPLE),
  doc: badge("DOC", BLUE),
  docx: badge("DOC", BLUE),
  odt: badge("DOC", BLUE),
  rtf: badge("RTF", BLUE),
  pages: badge("DOC", BLUE),
  ppt: badge("PPT", ORANGE),
  pptx: badge("PPT", ORANGE),
  key: badge("KEY", ORANGE),
  odp: badge("PPT", ORANGE),
  txt: badge("TXT", GREY),
  log: badge("LOG", GREY),
  json: badge("JSON", YELLOW),
  jsonc: badge("JSON", YELLOW),
  yml: badge("YML", RED),
  yaml: badge("YML", RED),
  toml: badge("TOML", GREY),
  xml: badge("XML", ORANGE),
  ts: badge("TS", BLUE),
  tsx: badge("TSX", BLUE),
  js: badge("JS", YELLOW),
  jsx: badge("JSX", YELLOW),
  mjs: badge("JS", YELLOW),
  cjs: badge("JS", YELLOW),
  py: badge("PY", BLUE),
  rs: badge("RS", ORANGE),
  go: badge("GO", TEAL),
  rb: badge("RB", RED),
  java: badge("JAVA", ORANGE),
  kt: badge("KT", PURPLE),
  swift: badge("SWFT", ORANGE),
  c: badge("C", BLUE),
  h: badge("H", BLUE),
  cpp: badge("C++", BLUE),
  hpp: badge("H++", BLUE),
  css: badge("CSS", PURPLE),
  scss: badge("SCSS", PURPLE),
  sass: badge("SASS", PURPLE),
  sql: badge("SQL", TEAL),
  sh: badge("SH", GREEN),
  bash: badge("SH", GREEN),
  zsh: badge("SH", GREEN),
  diff: badge("DIFF", GREEN),
  patch: badge("DIFF", GREEN),
  zip: badge("ZIP", YELLOW),
  tar: badge("TAR", YELLOW),
  gz: badge("GZ", YELLOW),
  tgz: badge("TGZ", YELLOW),
  "7z": badge("7Z", YELLOW),
  rar: badge("RAR", YELLOW),
  mp3: badge("MP3", PURPLE),
  wav: badge("WAV", PURPLE),
  flac: badge("FLAC", PURPLE),
  m4a: badge("M4A", PURPLE),
  mp4: badge("MP4", RED),
  mov: badge("MOV", RED),
  webm: badge("WEBM", RED),
  mkv: badge("MKV", RED),
}

const NAMES: Record<string, Badge> = {
  "package.json": badge("NPM", RED),
  "bun.lock": badge("LOCK", GREY),
  dockerfile: badge("DOCK", BLUE),
}

const basename = (path: string) => path.split("\\").join("/").split("/").findLast(Boolean) ?? ""

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".")
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : ""
}

function badgeFor(path: string): Badge | undefined {
  const name = basename(path).toLowerCase()
  const byName = NAMES[name]
  if (byName) return byName
  const ext = extensionOf(name)
  if (!ext) return undefined
  const known = EXTENSIONS[ext]
  if (known) return known
  return /^[a-z0-9]{1,4}$/.test(ext) ? badge(ext.toUpperCase(), GREY) : undefined
}

export const fileTone = (path: string): Tone | undefined => badgeFor(path)?.tone

const LABEL_FONT = "Satoshi, system-ui, sans-serif"
const OUTLINE = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'

function labelWidth(label: string) {
  return Math.min(17, Math.max(6, label.length * 4.1 + 0.6))
}

function pageMarkup(found: Badge | undefined): string {
  if (!found)
    return `<path d="M6 3h8l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" ${OUTLINE}/><path d="M14 3v4a2 2 0 0 0 2 2h4" ${OUTLINE}/>`
  const width = labelWidth(found.label)
  const from = Math.min(17.2, 2.4 + width + 1.4)
  const stub = `<path d="M${from.toFixed(1)} 21H18a2 2 0 0 0 2-2" ${OUTLINE}/>`
  return (
    `<path d="M4 12.8V5a2 2 0 0 1 2-2h8l6 6v10" ${OUTLINE}/>` +
    `<path d="M14 3v4a2 2 0 0 0 2 2h4" ${OUTLINE}/>` +
    stub +
    `<text x="2.4" y="21.1" font-family="${LABEL_FONT}" font-size="6.6" font-weight="800" textLength="${width.toFixed(1)}" lengthAdjust="spacingAndGlyphs" style="fill:light-dark(${found.tone[0]},${found.tone[1]})">${found.label}</text>`
  )
}

function folderMarkup(open: boolean): string {
  if (open)
    return `<path d="M3.5 17.5V6.5A1.5 1.5 0 0 1 5 5h3.8l2 2.4H18a1.5 1.5 0 0 1 1.5 1.5v1.6" ${OUTLINE}/><path d="M3.6 18.5l2-7a1.5 1.5 0 0 1 1.4-1.1h13.6a1 1 0 0 1 1 1.3l-1.8 6.2a1.5 1.5 0 0 1-1.4 1H4.6" ${OUTLINE}/>`
  return `<path d="M3.5 7A2 2 0 0 1 5.5 5h3.6l2 2.4h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" ${OUTLINE}/>`
}

function glyphMarkup(path: string, type: "file" | "directory", expanded: boolean): string {
  return type === "directory" ? folderMarkup(expanded) : pageMarkup(badgeFor(path))
}

const SVG_ATTRS = 'viewBox="0 0 24 24" aria-hidden="true" data-component="file-icon"'

export function fileIconMarkup(path: string): string {
  const directory = path.endsWith("/")
  const inner = glyphMarkup(path, directory ? "directory" : "file", false)
  return `<svg ${SVG_ATTRS} data-kind="${directory ? "directory" : "file"}">${inner}</svg>`
}

export function fileIconSprite() {
  const symbols: string[] = []
  const byFileExtension: Record<string, string> = {}
  const seen = new Set<string>()
  const add = (id: string, markup: string) => {
    if (seen.has(id)) return
    seen.add(id)
    symbols.push(`<symbol id="${id}" viewBox="0 0 24 24">${markup}</symbol>`)
  }
  for (const [ext, found] of Object.entries(EXTENSIONS)) {
    const id = `kiko-file-${found.label.toLowerCase().replace(/\W/g, "x")}-${found.tone[0].slice(1)}`
    add(id, pageMarkup(found))
    byFileExtension[ext] = id
  }
  add("kiko-file-plain", pageMarkup(undefined))
  return {
    spriteSheet: `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true">${symbols.join("")}</svg>`,
    byFileExtension,
    plain: "kiko-file-plain",
  }
}

export type FileIconProps = JSX.GSVGAttributes<SVGSVGElement> & {
  node: { path: string; type: "file" | "directory" }
  expanded?: boolean
}

const server = typeof document === "undefined"

export const FileIcon: Component<FileIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["node", "class", "classList", "expanded"])
  const inner = createMemo(() => glyphMarkup(local.node.path, local.node.type, local.expanded ?? false))
  if (server) {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        data-component="file-icon"
        data-kind={local.node.type}
        {...rest}
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
        innerHTML={inner()}
      />
    )
  }
  let element!: SVGSVGElement
  createEffect(() => element.replaceChildren(...glyphNodes(inner())))
  return (
    <svg
      ref={element}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-component="file-icon"
      data-kind={local.node.type}
      {...rest}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    />
  )
}
