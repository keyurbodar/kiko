import { CardView } from "./card/CardView"
import type { Placement } from "./card/placement"
import { closeCard } from "./card-state"

/** The chat card, shown over the thread for the open chat. */
export default function Card(props: { chatId: string; placement: Placement }) {
  return <CardView chatId={props.chatId} placement={props.placement} onClose={closeCard} />
}
