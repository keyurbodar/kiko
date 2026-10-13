import { CardView } from "./card/CardView"
import { closeCard } from "./card-state"

/** The chat card, shown over the thread for the open chat. */
export default function Card(props: { chatId: string }) {
  return <CardView chatId={props.chatId} onClose={closeCard} />
}
