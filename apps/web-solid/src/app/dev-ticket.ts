import { loadClerk } from "./clerk"

export async function signInWithTicket(ticket: string): Promise<void> {
  const clerk = await loadClerk()
  if (!clerk.client) throw new Error("Clerk did not load")
  const attempt = await clerk.client.signIn.create({ strategy: "ticket", ticket })
  if (attempt.status !== "complete") throw new Error(`Ticket sign-in ended as ${attempt.status}`)
  await clerk.setActive({ session: attempt.createdSessionId })
}
