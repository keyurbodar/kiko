import { DurableObject } from "cloudflare:workers"
import type { Env } from "../index"

export class RoomDO extends DurableObject<Env> {}
