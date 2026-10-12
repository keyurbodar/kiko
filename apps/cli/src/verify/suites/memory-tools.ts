import { agentText, newRoom } from "../kit"
import type { MemoryOp, MemoryResult, } from "@yuki/protocol"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { must } from "../must"



function codename(): string {
  const consonants = "bdfgklmnprstvz"
  const vowels = "aeiou"
  const pick = (s: string) => s.charAt(must(crypto.getRandomValues(new Uint8Array(1))[0], "random byte") % s.length)
  return `${pick(consonants)}${pick(vowels)}${pick(consonants)}${pick(vowels)}${pick(consonants)}${pick(vowels)}lix`
}


const suite: Suite = {
  name: "memory-tools",
  model: true,
  async run(v) {
    const s = await v.as(`memtools${Date.now()}`)
    await connectTestModel(s)
    const user = await s.user()
    let n = 0
    const memory = async (op: MemoryOp): Promise<MemoryResult> => {
      const reqId = `m${++n}`
      user.send({ t: "memory", reqId, op })
      const frame = await user.expect((f) => f.t === "memory_result" && f.reqId === reqId)
      return (frame as { result: MemoryResult }).result
    }
    const name = codename()

    const first = (await newRoom(s, "memory one")).room
    first.send(`my sister's name is ${name.charAt(0).toUpperCase() + name.slice(1)}. remember that. reply in five words.`)

    let saved = ""
    const end = Date.now() + 90_000
    while (!saved) {
      if (Date.now() > end) throw new VerifyError(`no life line holds ${name}. the agent said: ${JSON.stringify(agentText(first))}`)
      await Bun.sleep(1_000)
      const all = await memory({ op: "list" })
      const hit = "lines" in all ? all.lines.find((l) => l.text.toLowerCase().includes(name)) : undefined
      if (hit) saved = `${hit.source}: ${hit.text}`
    }
    if (!saved.startsWith("@") && !saved.startsWith("you: ")) throw new VerifyError(`the line names no writer, neither an agent's note nor the human's captured words: ${saved}`)
    console.log(`  saved ${saved}`)
    for (let i = 0; i < 60 && !agentText(first); i++) await Bun.sleep(500)

    const second = (await newRoom(s, "memory two")).room
    second.send("what is my sister's name? answer with just the name.")
    const until = Date.now() + 60_000
    while (!agentText(second).toLowerCase().includes(name)) {
      if (Date.now() > until) throw new VerifyError(`the second chat did not recall ${name}. it said: ${JSON.stringify(agentText(second))}`)
      await Bun.sleep(500)
    }
    console.log(`  second chat answered ${JSON.stringify(agentText(second))}`)
    for (const room of [first, second]) user.send({ t: "chat", op: { op: "delete", roomId: room.id as never } })
  },
}

export default suite
