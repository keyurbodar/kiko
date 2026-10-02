import { DurableObject } from "cloudflare:workers"
import type { Env } from "../index"

export class AgentDO extends DurableObject<Env> {}
