import { BotAvatar } from "../roster";
import type { RosterBot } from "../../lib/roster";

export function BotMention({ bot }: { bot: RosterBot }) {
  return (
    <span
      data-testid={`bot-mention-${bot.id}`}
      className="inline-flex items-center gap-1 rounded-full bg-rose-tint px-1.5 py-0.5 align-baseline text-caption-1 font-medium whitespace-nowrap text-rose-text"
      title={bot.name}
    >
      <BotAvatar name={bot.name} src={bot.avatarImage} size={13} className="shrink-0" />
      <span>{bot.name}</span>
    </span>
  );
}
