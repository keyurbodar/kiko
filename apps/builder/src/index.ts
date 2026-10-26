import { DurableObject, WorkerEntrypoint } from "cloudflare:workers"
import { type BuildResult, buildCapsule, type Target } from "./build"

type Env = { BUILDER: DurableObjectNamespace<Builder> }

export class Builder extends DurableObject<Env> {
  async build(files: Record<string, string>, target: Target): Promise<BuildResult> {
    return buildCapsule(files, target)
  }
}

export default class extends WorkerEntrypoint<Env> {
  async build(files: Record<string, string>, target: Target): Promise<BuildResult> {
    return this.env.BUILDER.get(this.env.BUILDER.idFromName("builder")).build(files, target)
  }

  async fetch(): Promise<Response> {
    return new Response("not found", { status: 404 })
  }
}
