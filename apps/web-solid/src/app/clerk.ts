import { Clerk } from "@clerk/clerk-js"
import { CLERK_KEY, type Profile, type Provider } from "./hosted"

/*
 * Headless Clerk. Imported only by the sign-in screen, the callback, and sign-out, so no tier 1 to 3
 * chunk carries it. The app asks Clerk once, trades the session token for the backend's own, and
 * never talks to Clerk again on the hot path.
 */

let loading: Promise<Clerk> | undefined

export function loadClerk(): Promise<Clerk> {
  if (!CLERK_KEY) return Promise.reject(new Error("Sign-in is not set up"))
  loading ??= (async () => {
    const clerk = new Clerk(CLERK_KEY)
    await clerk.load()
    return clerk
  })()
  loading.catch(() => {
    loading = undefined
  })
  return loading
}

export async function startOAuth(provider: Provider): Promise<void> {
  const clerk = await loadClerk()
  await clerk.client?.signIn.authenticateWithRedirect({
    strategy: provider === "google" ? "oauth_google" : "oauth_github",
    redirectUrl: "/sso-callback",
    redirectUrlComplete: "/",
  })
}

export async function finishOAuth(): Promise<void> {
  const clerk = await loadClerk()
  await clerk.handleRedirectCallback({ signInFallbackRedirectUrl: "/", signUpFallbackRedirectUrl: "/" }, async () => {})
}

export interface ClerkSignIn {
  token: string
  backendUrl: string | null
  profile: Profile
}

/** The signed-in Clerk person, or null when Clerk holds no session. */
export async function clerkSignIn(): Promise<ClerkSignIn | null> {
  const clerk = await loadClerk()
  const { session, user } = clerk
  if (!session || !user) return null
  const token = await session.getToken()
  if (!token) return null
  const account = user.externalAccounts[0]
  const provider = String(account?.provider ?? "").replace(/^oauth_/, "")
  const url = user.publicMetadata.backendUrl
  return {
    token,
    backendUrl: typeof url === "string" && url ? url : null,
    profile: {
      name: user.fullName ?? user.username ?? user.primaryEmailAddress?.emailAddress ?? "You",
      email: user.primaryEmailAddress?.emailAddress ?? "",
      imageUrl: user.imageUrl,
      provider: provider === "google" || provider === "github" ? provider : null,
    },
  }
}

export async function clerkSignOut(): Promise<void> {
  const clerk = await loadClerk()
  await clerk.signOut()
}
