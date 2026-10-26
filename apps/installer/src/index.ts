import { DurableObject } from "cloudflare:workers"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import { Clerk, clerkRest } from "./clerk"
import { codeCache } from "./code-cache"
import type { InstallFailed } from "./failure"
import handler, { answerReply, type Env, exitReply, type InstallReply } from "./handler"
import { CodeCache, Http, InstallerConfig, type InstallRequest, makeInstaller } from "./install"

export default handler

const logged = <A>(exit: Exit.Exit<A, InstallFailed>, reply: InstallReply): InstallReply => {
  if (Exit.isFailure(exit)) console.error(`install failed: ${JSON.stringify(reply.body)}`)
  return reply
}

export class Installer extends DurableObject<Env> {
  readonly #installer = Effect.runSync(makeInstaller)

  readonly #services = Layer.mergeAll(
    Layer.succeed(Http, Http.of({ fetch: (input, init) => fetch(input, init) })),
    Layer.succeed(
      InstallerConfig,
      InstallerConfig.of({
        oauthClientId: this.env.CF_OAUTH_CLIENT_ID,
        releaseBase: this.env.RELEASE_BASE_URL,
        releasePublicKey: this.env.RELEASE_PUBLIC_KEY,
        random: () => crypto.getRandomValues(new Uint8Array(32)),
      }),
    ),
    Layer.succeed(
      Clerk,
      clerkRest({ secretKey: this.env.CLERK_SECRET_KEY, fetch: (input, init) => fetch(input, init) }),
    ),
    Layer.succeed(CodeCache, codeCache(this.ctx.storage)),
  )

  async install(request: InstallRequest): Promise<InstallReply> {
    const exit = await Effect.runPromiseExit(this.#installer.install(request).pipe(Effect.provide(this.#services)))
    return logged(exit, exitReply(exit, answerReply))
  }

  async detach(sub: string): Promise<InstallReply> {
    const exit = await Effect.runPromiseExit(this.#installer.detach(sub).pipe(Effect.provide(this.#services)))
    return logged(
      exit,
      exitReply(exit, () => ({ status: 204, body: null })),
    )
  }
}
