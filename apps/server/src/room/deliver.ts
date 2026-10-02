import type { RoomEvent } from "@kiko/protocol"
import type { RoomLog } from "./log"

// Architecture section 14. Deliveries from outside the room (reminders today) arrive
// at least once. Each has a stable id, and `deliveries` remembers every id the room
// has stored, so a repeat stores and sends nothing.

export type ReminderDelivery = {
	text: string
	/** `human`, or the agent slug the reminder is for. */
	target: string
}

export class Deliveries {
	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
	) {
		storage.sql.exec("CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, at INTEGER NOT NULL)")
	}

	seen(id: string): boolean {
		return this.storage.sql.exec("SELECT 1 FROM deliveries WHERE id = ?", id).toArray().length > 0
	}

	/**
	 * Stores a reminder as a message from `system:reminder`. Returns the event to
	 * publish, or null when the id was delivered before.
	 *
	 * ASSUMPTION: an agent-target reminder is also a room message for now, addressed
	 * to the agent by name. The envelope to the agent's inbox comes with the delivery task.
	 */
	reminder(id: string, reminder: ReminderDelivery): RoomEvent | null {
		return this.storage.transactionSync(() => {
			if (this.seen(id)) return null
			const text = reminder.target === "human" ? `reminder: ${reminder.text}` : `reminder for @${reminder.target}: ${reminder.text}`
			const { event } = this.log.addMessage({ from: { kind: "system", reason: "reminder" }, text })
			this.storage.sql.exec("INSERT INTO deliveries (id, at) VALUES (?, ?)", id, Date.now())
			return event
		})
	}
}
