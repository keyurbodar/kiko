// Builds and deploys the hosted front door (docs/app-kiko.md): a signed backend release, the hosted client, and
// the release copied under /releases so the installer and one-click update can read it. Usage:
//   VITE_CLERK_PUBLISHABLE_KEY=pk_... VITE_INSTALLER_URL=https://... bun scripts/deploy-front-door.ts
// Wrangler deploys to the account it is signed in to.

import { cp, rm } from "node:fs/promises"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const WEB = join(ROOT, "apps/web-solid")

for (const name of ["VITE_CLERK_PUBLISHABLE_KEY", "VITE_INSTALLER_URL"]) {
  if (!process.env[name]) throw new Error(`${name} is not set`)
}

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" })
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`)
}

// The client first: the release's dry run reads apps/server/wrangler.jsonc, which points at the client's dist.
await run(["bun", "run", "build"], WEB, { NODE_ENV: "production" })
await run(["bun", "scripts/release.ts"], ROOT)
await rm(join(WEB, "dist/releases"), { recursive: true, force: true })
await cp(join(ROOT, "dist-release"), join(WEB, "dist/releases"), { recursive: true })
await run(["bunx", "wrangler", "deploy", "--config", join(WEB, "wrangler.jsonc")], join(ROOT, "apps/server"))
