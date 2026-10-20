import { RoomDO } from "../src/room/room-do"
import { UserDO } from "../src/user/user-do"
import { AgentProbe as AgentDO, agentObject } from "./agent-service"

// The real objects, plus one method that reads their storage. PRAGMA table_info keeps column order and
// type, so a column that moves, changes type, or changes NOT NULL shows up too, not only a missing one.
function schemaOf(sql: SqlStorage) {
	const tables = sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name").toArray()
	return Object.fromEntries(
		tables.map(({ name }) => [
			name,
			{
				columns: sql.exec(`PRAGMA table_info("${name}")`).toArray(),
				indexes: sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name", name).toArray().map((i) => i.name),
			},
		]),
	)
}

export class RoomProbe extends RoomDO {
	schemaDump() {
		return schemaOf(this.ctx.storage.sql)
	}
}

export class UserProbe extends UserDO {
	schemaDump() {
		return schemaOf(this.ctx.storage.sql)
	}
}

class AgentProbeService extends AgentDO {
	schemaDump() {
		return schemaOf(this.ctx.storage.sql)
	}
}

type Env = { ROOM: DurableObjectNamespace<RoomProbe>; USER: DurableObjectNamespace<UserProbe>; AGENT: DurableObjectNamespace<AgentProbe> }

export default {
	async fetch(request: Request, env: Env) {
		const kind = new URL(request.url).pathname.split("/")[1]
		if (kind === "room") return Response.json(await env.ROOM.get(env.ROOM.newUniqueId()).schemaDump())
		if (kind === "agent") return Response.json(await env.AGENT.get(env.AGENT.newUniqueId()).schemaDump())
		return Response.json(await env.USER.get(env.USER.newUniqueId()).schemaDump())
	},
}

export const AgentProbe = agentObject(AgentProbeService)
