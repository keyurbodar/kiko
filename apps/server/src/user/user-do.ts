import { DurableObject } from "cloudflare:workers"
import type { Env } from "../index"

export class UserDO extends DurableObject<Env> {}
