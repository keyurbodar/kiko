import { Clerk } from "@clerk/clerk-js"
import { CLERK_KEY, type Profile } from "./hosted"

type Options = NonNullable<Parameters<Clerk["load"]>[0]>
type ClerkUI = Awaited<NonNullable<NonNullable<Options["ui"]>["ClerkUI"]>>

/*
 * Clerk with its prebuilt sign-in modal. Imported only by the sign-in screen and sign-out, so no tier 1
 * to 3 chunk carries it. `@clerk/clerk-js` ships without the prebuilt components, so the UI script is
 * hotloaded from the instance's own front-end host, the way `@clerk/react` does it. The app asks Clerk
 * once, trades the session token for the backend's own, and never talks to Clerk again on the hot path.
 */

const UI_VERSION = "1"

const BLOCKED = "Could not load the sign-in form. Check your connection. If you use an ad blocker or Private DNS, allow clerk.kiko.works, then try again."

/** The Clerk front-end host is the publishable key's payload: base64 of `host$`. */
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
    script.onerror = () => reject(new Error(BLOCKED))
    script.onload = () => {
      const ctor = w.__internal_ClerkUICtor
      if (ctor) resolve(ctor)
      else reject(new Error(BLOCKED))
    }
    document.head.append(script)
  })
}

/*
 * Clerk's stock structure with its colors bound to kiko's live palette through CSS variables, so a theme
 * change reaches the portaled modal without a remount (t3code's clerkAppearance). The palette's card is
 * translucent, so the modal takes the opaque popover surface.
 */
export const appearance = {
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
    colorRing: "var(--ring)",
  },
}

let loading: Promise<Clerk> | undefined

export function loadClerk(): Promise<Clerk> {
  if (!CLERK_KEY) return Promise.reject(new Error("Sign-in is not set up"))
  const key = CLERK_KEY
  loading ??= (async () => {
    const clerk = new Clerk(key)
    const ui = loadUi(key)
    ui.catch(() => {})
    // Clerk's own load errors are written for developers, so the person gets one plain sentence.
    await clerk.load({ ui: { ClerkUI: ui }, appearance }).catch((e: unknown) => {
      console.error("clerk load failed", e)
      throw new Error(BLOCKED)
    })
    return clerk
  })()
  loading.catch(() => {
    loading = undefined
  })
  return loading
}

/** Opens Clerk's prebuilt sign-in modal. Sign-up lives in the same modal and returns here too. */
export async function openSignIn(): Promise<void> {
  const clerk = await loadClerk()
  const href = window.location.href
  clerk.openSignIn({ forceRedirectUrl: href, signUpForceRedirectUrl: href })
}

/** Calls back each time Clerk gains a session, for example when the modal finishes without a page load. */
export async function onClerkSession(callback: (active: boolean) => void): Promise<() => void> {
  const clerk = await loadClerk()
  let previous: string | null | undefined
  return clerk.addListener(({ session }) => {
    const identity = session?.id ?? null
    if (identity === previous) return
    previous = identity
    callback(!!session)
  })
}

export interface ClerkSignIn {
  token: string
  userId: string
  backendUrl: string | null
  profile: Profile
}

/** The signed-in Clerk person, or null when Clerk holds no session. */
export async function clerkSignIn(): Promise<ClerkSignIn | null> {
  const clerk = await loadClerk()
  const { session, user } = clerk
  if (!session || !user) return null
  const token = await session.getToken()
  if (!token || clerk.session !== session || clerk.user !== user) return null
  const account = user.externalAccounts[0]
  const provider = String(account?.provider ?? "").replace(/^oauth_/, "")
  const url = user.publicMetadata.backendUrl
  return {
    token,
    userId: user.id,
    backendUrl: typeof url === "string" && url ? url : null,
    profile: {
      name: user.fullName ?? user.username ?? user.primaryEmailAddress?.emailAddress ?? "You",
      email: user.primaryEmailAddress?.emailAddress ?? "",
      imageUrl: user.imageUrl,
      provider: provider || null,
    },
  }
}

export async function clerkSignOut(): Promise<void> {
  const clerk = await loadClerk()
  await clerk.signOut()
}
