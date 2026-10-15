// Sets up and tears down the Clerk dev instance's test owner for `bun kiko verify clerk` and the hosted browser check.
//   up [backendUrl]   creates the owner, optionally records its backend URL, prints the Worker flags
//   ticket            prints a sign-in token for the owner (opens the hosted client as that user in a dev build)
//   down              deletes the test users
// Needs CLERK_SECRET_KEY in the environment. Prints no secret.
import { deleteUser, ensureUser, instanceKey, OWNER_EXTERNAL_ID, setBackendUrl, signInToken, STRANGER_EXTERNAL_ID } from "../apps/cli/src/verify/clerk-kit"

const [command, arg] = process.argv.slice(2)
if (!process.env.CLERK_SECRET_KEY) throw new Error("set CLERK_SECRET_KEY first")

if (command === "up") {
  const owner = await ensureUser(OWNER_EXTERNAL_ID)
  if (arg) await setBackendUrl(owner, arg)
  console.log(`KIKO_CLERK_OWNER_ID=${owner}`)
  console.log(`--var OWNER_ID:${owner} --var CLERK_JWT_KEY:${await instanceKey()}`)
} else if (command === "ticket") {
  console.log(await signInToken(await ensureUser(OWNER_EXTERNAL_ID)))
} else if (command === "down") {
  await deleteUser(OWNER_EXTERNAL_ID)
  await deleteUser(STRANGER_EXTERNAL_ID)
  console.log("deleted")
} else {
  throw new Error("usage: clerk-dev.ts up [backendUrl] | ticket | down")
}
