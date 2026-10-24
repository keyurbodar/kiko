import { Clerk } from "@clerk/clerk-js"
import type { ClerkUser } from "./machine"
import { CLERK_KEY, type Profile } from "./hosted"
import { ClerkUserId } from "./phase"

type Options = NonNullable<Parameters<Clerk["load"]>[0]>
type ClerkUI = Awaited<NonNullable<NonNullable<Options["ui"]>["ClerkUI"]>>
type User = NonNullable<Clerk["user"]>

const UI_VERSION = "1"

const BLOCKED =
  "Could not load the sign-in form. Check your connection. If you use an ad blocker or Private DNS, allow clerk.kiko.works, then try again."

function frontendHost(key: string): string {
  return atob(key.split("_").slice(2).join("_")).replace(/\$$/, "")
}

function loadUi(key: string): Promise<ClerkUI> {
  const w = window as unknown as { __internal_ClerkUICtor?: ClerkUI }
  return new Promise((resolve, reject) => {
    if (w.__internal_ClerkUICtor) return resolve(w.__internal_ClerkUICtor)
    const script = document.createElement("script")
    script.src = `https://${frontendHost(key)}/npm/@clerk/ui@${UI_VERSION}/dist/ui.browser.js`
    script.async = true
    script.crossOrigin = "anonymous"
    script.setAttribute("data-clerk-publishable-key", key)
    script.addEventListener("error", () => reject(new Error(BLOCKED)))
    script.addEventListener("load", () => {
      const ctor = w.__internal_ClerkUICtor
      if (ctor) resolve(ctor)
      else reject(new Error(BLOCKED))
    })
    document.head.append(script)
  })
}

const appearance = {
  elements: {
    formButtonPrimary: { boxShadow: "none" },
    formFieldInput: { boxShadow: "none", outline: "none" },
    socialButtonsBlockButton: { boxShadow: "none" },
  },
  variables: {
    colorPrimary: "var(--foreground)",
    colorPrimaryForeground: "var(--popover)",
    colorDanger: "var(--error)",
    colorSuccess: "var(--success)",
    colorWarning: "var(--warning)",
    colorNeutral: "var(--foreground)",
    colorForeground: "var(--foreground)",
    colorMuted: "color-mix(in srgb, var(--popover) 98%, var(--foreground))",
    colorMutedForeground: "var(--muted-foreground)",
    colorBackground: "var(--popover)",
    colorInputForeground: "var(--foreground)",
    colorInput: "var(--input)",
    colorRing: "transparent",
  },
}

const emailOf = (user: User) => user.primaryEmailAddress?.emailAddress ?? ""

const userOf = (user: User): ClerkUser => ({ id: ClerkUserId.make(user.id), email: emailOf(user) })

function profileOf(user: User): Profile {
  const provider = String(user.externalAccounts[0]?.provider ?? "").replace(/^oauth_/, "")
  return {
    name: user.fullName ?? user.username ?? (emailOf(user) || "You"),
    email: emailOf(user),
    imageUrl: user.imageUrl,
    provider: provider || null,
  }
}

function pointerOf(user: User): string | null {
  const pointer = user.publicMetadata.kiko as { v?: unknown; url?: unknown } | undefined
  return pointer?.v === 1 && typeof pointer.url === "string" && pointer.url ? pointer.url : null
}

const stay = () => {}

function within(to: string): void {
  const next = new URL(to, location.href)
  if (next.pathname !== location.pathname || next.search !== location.search) return
  if (next.hash !== location.hash) location.hash = next.hash
}

interface Loaded {
  readonly clerk: Clerk
  readonly ui: Promise<ClerkUI>
}

const listeners = new Set<(user: ClerkUser | null) => void>()

let loading: Promise<Loaded> | undefined

function follow(clerk: Clerk): void {
  let last = clerk.user?.id ?? null
  clerk.addListener(
    ({ user }) => {
      const id = user?.id ?? null
      if (id === last) return
      last = id
      const next = user ? userOf(user) : null
      for (const listener of listeners) listener(next)
    },
    { skipInitialEmit: true },
  )
}

function load(): Promise<Loaded> {
  if (!CLERK_KEY) return Promise.reject(new Error("Sign-in is not set up"))
  const key = CLERK_KEY
  loading ??= (async () => {
    const clerk = new Clerk(key)
    const ui = loadUi(key)
    ui.catch(() => {})
    await clerk
      .load({ ui: { ClerkUI: ui }, appearance, routerPush: within, routerReplace: within })
      .catch((e: unknown) => {
        console.error("clerk load failed", e)
        throw new Error(BLOCKED)
      })
    follow(clerk)
    return { clerk, ui }
  })()
  loading.catch(() => {
    loading = undefined
  })
  return loading
}

export const loadClerk = (): Promise<Clerk> => load().then(({ clerk }) => clerk)

export async function clerkUser(): Promise<ClerkUser | null> {
  const { user } = await loadClerk()
  return user ? userOf(user) : null
}

export function onClerkUser(listener: (user: ClerkUser | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface Pointed {
  readonly url: string | null
  readonly profile: Profile
}

export async function clerkPointer(): Promise<Pointed | null> {
  const { user } = await loadClerk()
  if (!user) return null
  const fresh = await user.reload()
  return { url: pointerOf(fresh), profile: profileOf(fresh) }
}

export async function clerkToken(fresh: boolean): Promise<string | null> {
  const { session } = await loadClerk()
  return session ? session.getToken(fresh ? { skipCache: true } : undefined) : null
}

export async function clerkSignOut(): Promise<void> {
  const clerk = await loadClerk()
  await clerk.signOut(stay)
  if (clerk.client?.signedInSessions.length) throw new Error("Clerk kept the session")
}

export async function mountSignIn(node: HTMLDivElement): Promise<() => void> {
  const { clerk, ui } = await load()
  await ui
  const href = location.origin + location.pathname + location.search
  clerk.mountSignIn(node, { routing: "hash", withSignUp: true, forceRedirectUrl: href, signUpForceRedirectUrl: href })
  return () => clerk.unmountSignIn(node)
}
