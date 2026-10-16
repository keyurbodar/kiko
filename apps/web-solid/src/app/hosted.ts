import { createSignal } from "solid-js"
import { read, write } from "../lib/api-base"

/*
 * The hosted app (docs/app-kiko.md): sign-in goes through Clerk, which only the sign-in screen and the
 * callback load. This file holds what every tier may know: whether the build is hosted, and the cached
 * profile that lets the Account page paint at once.
 */

export const CLERK_KEY: string | undefined = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || undefined
export const hosted = CLERK_KEY !== undefined

export interface Profile {
  name: string
  email: string
  imageUrl: string
  provider: string | null
}

const PROFILE_KEY = "kiko:profile"

function readProfile(): Profile | null {
  try {
    const value = JSON.parse(read(PROFILE_KEY) ?? "null") as Partial<Profile> | null
    return value && typeof value.name === "string" ? { name: value.name, email: value.email ?? "", imageUrl: value.imageUrl ?? "", provider: value.provider ?? null } : null
  } catch {
    return null
  }
}

const [profile, setProfileSignal] = createSignal<Profile | null>(readProfile())
export { profile }

export function setProfile(next: Profile | null): void {
  write(PROFILE_KEY, next ? JSON.stringify(next) : null)
  setProfileSignal(next)
}
