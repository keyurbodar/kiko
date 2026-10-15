import { loadClerk } from "./clerk"

/** Development builds only. A Clerk sign-in token (POST /v1/sign_in_tokens) stands in for the Google or GitHub round trip. */
export async function signInWithTicket(ticket: string): Promise<void> {
  const clerk = await loadClerk()
  if (!clerk.client) throw new Error("Clerk did not load")
  const attempt = await clerk.client.signIn.create({ strategy: "ticket", ticket })
  if (attempt.status !== "complete") throw new Error(`Ticket sign-in ended as ${attempt.status}`)
  await clerk.setActive({ session: attempt.createdSessionId })
}
