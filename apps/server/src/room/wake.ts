import type { AgentSlug, Envelope, SystemReason } from "@yuki/protocol"
import type { Chain } from "./mail"


export type Wake = {
	id: string
	to: AgentSlug
	why: SystemReason
	body: string
	chain: Chain | null
	seq?: number
}

export type WakeResult = "delivered" | "refused" | "gone" | "duplicate"

export function wakeStamp(w: Pick<Wake, "id" | "chain">, stopped: (rootId: string) => boolean): Pick<Envelope, "rootId" | "hop"> {
	const chain = w.chain
	if (!chain || stopped(chain.rootId)) return { rootId: w.id, hop: 0 }
	return { rootId: chain.rootId, hop: chain.hop }
}
