// Translucency and the chat background, as in monocode (MIT, Copyright (c) 2026 Nick):
// src/features/settings/model/appearance.ts and newThreadBackgroundEffects.ts. Both stay on
// this device, as in monocode. kat.css section 4d draws them from the variables set here.
//
// The settings live in localStorage, which the inline script in index.html reads before first
// paint, so the glass and the blurred stand-in desktop are there on the first frame. The sharp
// picture is in IndexedDB and fades in when it is read, as monocode's does.

import { createRoot, createSignal } from "solid-js"

export type BackgroundEffect = "none" | "dither" | "ascii" | "halftone" | "scanlines" | "gradient-blur"
export const BACKGROUND_EFFECTS: readonly BackgroundEffect[] = ["none", "dither", "ascii", "halftone", "scanlines", "gradient-blur"]
export const EFFECT_LABELS: Record<BackgroundEffect, string> = {
  none: "none",
  dither: "dither",
  ascii: "ascii",
  halftone: "halftone",
  scanlines: "scanlines",
  "gradient-blur": "haze",
}
export const EFFECT_DESCRIPTIONS: Record<BackgroundEffect, string> = {
  none: "shows the original picture.",
  dither: "rebuilds the picture with a dithered color palette.",
  ascii: "recreates the picture with colored characters on black.",
  halftone: "recreates the picture with colored print dots on black.",
  scanlines: "adds a pronounced horizontal display-line texture.",
  "gradient-blur": "blurs and fades the picture into the background below.",
}
export type BackgroundScope = "empty" | "all"

/** Monocode's ranges and defaults. */
export const SIDEBAR_OPACITY = { min: 0.15, max: 1, default: 0.85 } as const
export const BLUR_RADIUS = { min: 1, max: 64, default: 24 } as const
export const VISIBILITY = { min: 0.05, max: 0.65, default: 0.24 } as const

export type Glass = Readonly<{ opacity: number; blur: number; body: boolean }>
export const DEFAULT_GLASS: Glass = { opacity: SIDEBAR_OPACITY.default, blur: BLUR_RADIUS.default, body: true }

export type Background = Readonly<{
  /** Names the sharp picture in IndexedDB. */
  id: string
  /** A small blurred copy, the stand-in desktop. It is blurred anyway, so small loses nothing. */
  desktop: string
  effect: BackgroundEffect
  scope: BackgroundScope
  /** Visibility in an empty chat, and once it has messages. */
  empty: number
  session: number
}>

/** The keys the inline script in index.html reads. Keep the two in step. */
export const GLASS_KEY = "kiko:glass:v1"
export const BACKGROUND_KEY = "kiko:background:v1"

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
/** A number in range, rounded to `places` decimals, or the default. */
const num = (v: unknown, range: { min: number; max: number; default: number }, places = 2) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(clamp(v, range.min, range.max) * 10 ** places) / 10 ** places : range.default
const DESKTOP = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/
const MAX_DESKTOP_CHARS = 60_000

function json(text: string | null): unknown {
  try {
    return JSON.parse(text ?? "null")
  } catch {
    return null
  }
}

/** Reads stored glass settings. Anything it cannot read is monocode's default. */
export function parseGlass(text: string | null): Glass {
  const raw = json(text)
  if (!isRecord(raw)) return DEFAULT_GLASS
  return {
    opacity: num(raw.opacity, SIDEBAR_OPACITY),
    blur: num(raw.blur, BLUR_RADIUS, 0),
    body: typeof raw.body === "boolean" ? raw.body : DEFAULT_GLASS.body,
  }
}

/** Reads the stored background, or null for none. A malformed one is none, never half-applied. */
export function parseBackground(text: string | null): Background | null {
  const raw = json(text)
  if (!isRecord(raw) || typeof raw.id !== "string" || !/^[a-z0-9-]{1,64}$/.test(raw.id)) return null
  if (typeof raw.desktop !== "string" || raw.desktop.length > MAX_DESKTOP_CHARS || !DESKTOP.test(raw.desktop)) return null
  return {
    id: raw.id,
    desktop: raw.desktop,
    effect: BACKGROUND_EFFECTS.includes(raw.effect as BackgroundEffect) ? (raw.effect as BackgroundEffect) : "none",
    scope: raw.scope === "empty" ? "empty" : "all",
    empty: num(raw.empty, VISIBILITY),
    session: num(raw.session, VISIBILITY),
  }
}

/**
 * The root attributes and variables the settings set. Pure, and mirrored by the inline script in
 * index.html; a test runs both and compares. `null` removes an attribute.
 */
export function glassRoot(glass: Glass, background: Background | null): { attrs: Record<string, string | null>; vars: Record<string, string> } {
  return {
    attrs: {
      "data-desktop": background ? "" : null,
      "data-glass-body": glass.body ? "" : null,
      "data-chat-background": background ? "" : null,
      "data-chat-background-scope": background?.scope ?? null,
      "data-chat-background-effect": background?.effect ?? null,
    },
    vars: {
      "--sidebar-opacity": String(glass.opacity),
      "--glass-blur": `${glass.blur}px`,
      "--chat-background-empty-opacity": String(background?.empty ?? VISIBILITY.default),
      "--chat-background-session-opacity": String(background?.session ?? VISIBILITY.default),
      "--desktop-image": background ? `url("${background.desktop}")` : "none",
    },
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // private mode or quota: the setting still applies for this page load.
  }
}

const state = createRoot(() => {
  const [glass, setGlass] = createSignal<Glass>(parseGlass(read(GLASS_KEY)))
  const [background, setBackground] = createSignal<Background | null>(parseBackground(read(BACKGROUND_KEY)))
  /** The sharp picture's object URL, once IndexedDB has answered. */
  const [picture, setPicture] = createSignal<string | null>(null)
  return { glass, setGlass, background, setBackground, picture, setPicture }
})

export const glass = state.glass
export const background = state.background
/** The sharp picture as an object URL, for previews. Null until it is read. */
export const picture = state.picture

const hasDom = () => typeof document !== "undefined" && !!document.documentElement
const light = () => hasDom() && document.documentElement.dataset.appearance === "light"

function paintRoot(): void {
  if (!hasDom()) return
  const root = document.documentElement
  const { attrs, vars } = glassRoot(state.glass(), state.background())
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null) root.removeAttribute(name)
    else root.setAttribute(name, value)
  }
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
}

let revision = 0
let effectUrl: string | null = null

/** Draws the chat pane's picture with its effect. The newest call wins. */
async function paintPicture(): Promise<void> {
  if (!hasDom()) return
  const root = document.documentElement
  const bg = state.background()
  const src = state.picture()
  const mine = ++revision
  root.removeAttribute("data-chat-background-ready")
  const show = (url: string) => {
    if (mine !== revision) return
    root.style.setProperty("--chat-background-image", `url(${JSON.stringify(url)})`)
    root.setAttribute("data-chat-background-ready", "")
  }
  if (!bg || !src) {
    root.style.removeProperty("--chat-background-image")
    return
  }
  if (bg.effect === "none" || bg.effect === "gradient-blur") return show(src)
  try {
    const { renderEffect } = await import("./background-effects")
    const blob = await renderEffect(bg.id, src, bg.effect, light())
    if (mine !== revision) return
    if (effectUrl) URL.revokeObjectURL(effectUrl)
    effectUrl = URL.createObjectURL(blob)
    show(effectUrl)
  } catch {
    // An effect that fails shows the picture as it is, as in monocode.
    show(src)
  }
}

async function loadPicture(): Promise<void> {
  const bg = state.background()
  const old = state.picture()
  if (!bg) {
    state.setPicture(null)
  } else {
    const { loadPicture: load } = await import("./background-store")
    const blob = await load(bg.id)
    if (state.background()?.id !== bg.id) return
    state.setPicture(blob ? URL.createObjectURL(blob) : null)
  }
  if (old) URL.revokeObjectURL(old)
  await paintPicture()
}

export function setGlass(patch: Partial<Glass>): void {
  const next = parseGlass(JSON.stringify({ ...state.glass(), ...patch }))
  write(GLASS_KEY, JSON.stringify(next))
  state.setGlass(next)
  paintRoot()
}

/** Changes the background's settings. A new picture goes through `chooseBackground`. */
export function setBackground(patch: Partial<Omit<Background, "id" | "desktop">>): void {
  const current = state.background()
  if (!current) return
  const next = parseBackground(JSON.stringify({ ...current, ...patch }))
  if (!next) return
  write(BACKGROUND_KEY, JSON.stringify(next))
  state.setBackground(next)
  paintRoot()
  if (patch.effect !== undefined && patch.effect !== current.effect) void paintPicture()
}

/** Reads a picked image, keeps it on this device, and shows it. Throws a sentence a person can read. */
export async function chooseBackground(file: File): Promise<void> {
  const { prepareBackground } = await import("./background-image")
  const { savePicture, removePicture } = await import("./background-store")
  const prepared = await prepareBackground(file)
  const old = state.background()
  const id = crypto.randomUUID()
  await savePicture(id, prepared.sharp)
  const next: Background = {
    id,
    desktop: prepared.desktop,
    effect: old?.effect ?? "none",
    scope: old?.scope ?? "all",
    empty: old?.empty ?? VISIBILITY.default,
    session: old?.session ?? VISIBILITY.default,
  }
  write(BACKGROUND_KEY, JSON.stringify(next))
  state.setBackground(next)
  paintRoot()
  await loadPicture()
  if (old) await removePicture(old.id).catch(() => {})
}

export async function removeBackground(): Promise<void> {
  const old = state.background()
  write(BACKGROUND_KEY, null)
  state.setBackground(null)
  paintRoot()
  await loadPicture()
  if (old) {
    const { removePicture } = await import("./background-store")
    await removePicture(old.id).catch(() => {})
  }
}

let started = false

/**
 * Applies the settings and reads the picture. Called once, after first paint: the inline script
 * already painted the glass and the stand-in desktop, so this only adds the sharp picture.
 */
export function startGlass(): void {
  if (started || !hasDom()) return
  started = true
  paintRoot()
  void loadPicture()
  // ascii, halftone and scanlines draw on black or white paper, so they follow the appearance.
  let wasLight = light()
  new MutationObserver(() => {
    if (light() === wasLight) return
    wasLight = light()
    const effect = state.background()?.effect
    if (effect && effect !== "none" && effect !== "dither" && effect !== "gradient-blur") void paintPicture()
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-appearance"] })
  // Another tab changing a setting changes it here too.
  window.addEventListener("storage", (event) => {
    if (event.key === GLASS_KEY || event.key === null) state.setGlass(parseGlass(read(GLASS_KEY)))
    if (event.key === BACKGROUND_KEY || event.key === null) {
      const before = state.background()
      state.setBackground(parseBackground(read(BACKGROUND_KEY)))
      if (state.background()?.id !== before?.id) void loadPicture()
      else if (state.background()?.effect !== before?.effect) void paintPicture()
    }
    paintRoot()
  })
}
