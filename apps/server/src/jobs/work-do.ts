import { DurableObject } from "cloudflare:workers"
import type { Env } from "../index"
import { type ImageMeta, type ImageMetaInput, readImageMeta } from "./attachment"

// Architecture section 17.3. CPU-heavy job work runs here, not in the queue consumer. On the
// Workers Free plan a Worker invocation is stopped at random once it spends more than a few
// milliseconds of CPU (measured 2026-10-04: 3 of 20 requests at about 0.15 s), while a Durable
// Object call has 30 s. One object per user, named by the Worker from the user id. It keeps no state.

export class WorkDO extends DurableObject<Env> {
  /** The image's size and thumbhash, as far as asked. Null when the object is gone or unreadable. */
  async imageMeta(input: ImageMetaInput): Promise<ImageMeta> {
    return readImageMeta(this.env.FILES, input)
  }
}
