import {
  ArchiveIcon,
  CodeIcon,
  FileIcon,
  FileJsonIcon,
  FileMarkdownIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  LockIcon,
  SettingsIcon,
  TableIcon,
} from "@kiko/ui/icons"
import type { FileTreeIconConfig } from "@pierre/trees"

type Family =
  | "markdown"
  | "code"
  | "json"
  | "html"
  | "image"
  | "table"
  | "archive"
  | "text"
  | "config"
  | "lock"
  | "file"

const SHAPES: Record<Family, string> = {
  markdown: FileMarkdownIcon,
  code: CodeIcon,
  json: FileJsonIcon,
  html: GlobeIcon,
  image: ImageIcon,
  table: TableIcon,
  archive: ArchiveIcon,
  text: FileTextIcon,
  config: SettingsIcon,
  lock: LockIcon,
  file: FileIcon,
}

const SIZE = 15

const idOf = (family: Family) => `kiko-kds-${family}`

const EXTENSIONS: Record<string, Family> = {
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  json: "json",
  jsonc: "json",
  json5: "json",
  jsonl: "json",
  csv: "table",
  tsv: "table",
  xls: "table",
  xlsx: "table",
  ods: "table",
  numbers: "table",
  html: "html",
  htm: "html",
  xhtml: "html",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  ico: "image",
  svg: "image",
  heic: "image",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  bz2: "archive",
  xz: "archive",
  "7z": "archive",
  rar: "archive",
  jar: "archive",
  pdf: "text",
  doc: "text",
  docx: "text",
  rtf: "text",
  pages: "text",
  odt: "text",
  txt: "text",
  log: "text",
  rst: "text",
  yml: "config",
  yaml: "config",
  toml: "config",
  ini: "config",
  cfg: "config",
  conf: "config",
  editorconfig: "config",
  ts: "code",
  tsx: "code",
  js: "code",
  jsx: "code",
  mjs: "code",
  cjs: "code",
  mts: "code",
  cts: "code",
  py: "code",
  rs: "code",
  go: "code",
  rb: "code",
  java: "code",
  kt: "code",
  swift: "code",
  c: "code",
  h: "code",
  cc: "code",
  cpp: "code",
  hpp: "code",
  cs: "code",
  php: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  fish: "code",
  sql: "code",
  css: "code",
  scss: "code",
  sass: "code",
  less: "code",
  vue: "code",
  svelte: "code",
  xml: "code",
  diff: "code",
  patch: "code",
  graphql: "code",
  gql: "code",
}

const NAMES: Record<string, Family> = {
  "package.json": "config",
  "package-lock.json": "lock",
  "bun.lock": "lock",
  "bun.lockb": "lock",
  "yarn.lock": "lock",
  "pnpm-lock.yaml": "lock",
  "cargo.lock": "lock",
  "composer.lock": "lock",
  ".gitignore": "config",
  ".gitattributes": "config",
  ".editorconfig": "config",
  ".env": "config",
  dockerfile: "config",
  makefile: "config",
}

const icon = (family: Family) => ({ name: idOf(family), width: SIZE, height: SIZE, viewBox: "0 0 24 24" })

const byFamily = (rules: Record<string, Family>) =>
  Object.fromEntries(Object.entries(rules).map(([key, family]) => [key, icon(family)]))

const SPRITE = Object.entries(SHAPES)
  .map(([family, shape]) => `<symbol id="${idOf(family as Family)}" viewBox="0 0 24 24">${shape}</symbol>`)
  .join("")

export const KDS_FILE_TREE_ICONS: FileTreeIconConfig = {
  set: "none",
  colored: false,
  spriteSheet: `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="0" height="0">${SPRITE}</svg>`,
  byFileExtension: byFamily(EXTENSIONS),
  byFileName: byFamily(NAMES),
  remap: { "file-tree-icon-file": icon("file") },
}
