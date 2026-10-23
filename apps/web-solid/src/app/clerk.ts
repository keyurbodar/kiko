import { Clerk } from "@clerk/clerk-js"
import { CLERK_KEY, type Profile } from "./hosted"

type Options = NonNullable<Parameters<Clerk["load"]>[0]>
type ClerkUI = Awaited<NonNullable<NonNullable<Options["ui"]>["ClerkUI"]>>

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
    script.onerror = () => reject(new Error(BLOCKED))
    script.onload = () => {
      const ctor = w.__internal_ClerkUICtor
      if (ctor) resolve(ctor)
      else reject(new Error(BLOCKED))
    }
    document.head.append(script)
  })
}

export const appearance = {
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

let loading: Promise<Clerk> | undefined

export function loadClerk(): Promise<Clerk> {
  if (!CLERK_KEY) return Promise.reject(new Error("Sign-in is not set up"))
  const key = CLERK_KEY
  loading ??= (async () => {
    const clerk = new Clerk(key)
    const ui = loadUi(key)
    ui.catch(() => {})
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

export async function openSignIn(): Promise<void> {
  const clerk = await loadClerk()
  const href = window.location.href
  clerk.openSignIn({ forceRedirectUrl: href, signUpForceRedirectUrl: href })
}

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
