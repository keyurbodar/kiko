import { CliError, type Context } from "../main"
import { loadSuites, runSuites } from "../verify/runner"

export async function verify(ctx: Context): Promise<void> {
  if (ctx.list) {
    for (const s of await loadSuites()) console.log(`${s.name}${s.model ? " (model)" : ""}`)
    return
  }
  const failed = await runSuites({ url: ctx.url, noModel: ctx.noModel, fake: ctx.fake, names: ctx.args })
  if (failed.length) {
    throw new CliError(`${failed.length} suite${failed.length === 1 ? "" : "s"} failed: ${failed.join(", ")}`)
  }
}
