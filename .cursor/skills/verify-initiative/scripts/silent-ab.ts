// Silent-loop measurement, real model. bun silent-ab.ts <label>
import { openChat, reminders, say, setup, URL_ } from "./kit"

const MSGS = [
  "my tax filing is due on november 14.",
  "i'm going to start running three mornings a week.",
  "waiting on sara to send me the contract.",
  "maybe i'll learn spanish someday.",
  "the grant report has to go in by friday.",
  "thinking about moving to lisbon next spring, not sure yet.",
  "i told dan i'd send him the deck tomorrow.",
  "still waiting for the landlord to reply about the deposit.",
  "my passport expires in march so i need to renew it.",
  "might take up pottery, we'll see.",
  "planning to launch the newsletter on december 1.",
  "my sister's birthday is on the 3rd of november, i want to get her something good.",
  "i'm waiting to hear back from the vc about the term sheet.",
  "i should probably call the dentist at some point.",
  "demo for the client is next tuesday at 10am.",
  "i want to finish my thesis draft by the end of the month.",
  "maybe we could redo the kitchen next year?",
  "rent is due on the first, and i'm waiting on my paycheck.",
  "exam on december 5, i've barely started studying.",
  "i'm considering a trip to japan in april.",
]
const ANN = /\b(log(ged|ging)?|noted?|note that|track(ed|ing)?|added (it|that|this)|add(ed)? .* (to|in) (your|my) (loops?|list|tasks?)|loops?|keep(ing)? (an eye|track)|set (a|up a) reminder|reminder)\b/i
const label = process.argv[2] ?? "run"
const ctx = await setup({ name: `silent-${label}-${Date.now().toString(36)}`, jev: false })
let ann = 0, rem = 0
for (const [i, m] of MSGS.entries()) {
  const room = await openChat(ctx, `m${i}`)
  const before = (await reminders(ctx) as unknown[]).length
  const out = await say(room, m, 120_000)
  const after = (await reminders(ctx) as unknown[]).length
  const text = out.join(" / ")
  const a = ANN.test(text), r = after > before
  if (a) ann++
  if (r) rem++
  console.log(`${i}${a ? " ANN" : ""}${r ? " REM" : ""} | ${m}\n   -> ${text.slice(0, 300)}`)
}
console.log(`RESULT ${label}: announcements=${ann}/${MSGS.length} unrequested_reminders=${rem}/${MSGS.length}`)
ctx.v.closeAll()
process.exit(0)
