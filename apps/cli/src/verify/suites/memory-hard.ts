import { type Eval, type Fact, memorySuite } from "./memory-eval"


const meetingNotes = [
  "notes from the vendor sync, pasting so we have them:",
  "attendees were me, dana from procurement, and two people from northwind. agenda was the q1 rollout, the support tiers, and the renewal.",
  "q1 rollout: they want to move the pilot from 40 seats to 120 seats in january, pending the sso work on our side. dana says the sso ticket is ops-3312 and it is blocked on the identity team until mid december.",
  "support tiers: silver is 8x5 with a 4 hour response, gold is 24x7 with a 1 hour response. we are on silver and nobody wants to pay for gold yet. they offered a free month of gold during the rollout.",
  "renewal: the vendor contract renews on feb 28 for 18,400 dollars a year, auto-renew unless we give 60 days notice. dana wants a decision by the end of december.",
  "misc: their account manager is changing next quarter, the new one is called tomasz. they also mentioned a price increase of 6 percent for new customers, not for us.",
  "action items: me to check the seat count with finance, dana to chase the identity team, northwind to send the gold tier quote.",
].join("\n")

const FACTS: Fact[] = [
  { at: 6, said: "my sister priya lives in porto now, she moved in june", ask: "which city does priya live in?", expect: /porto/i },
  { at: 21, from: "ada", said: "for the kyoto leg i found the nozomi 21 at 7:40 from tokyo station on nov 10, reserved seats are still open. want me to book it?" },
  { at: 22, said: "yes do it", ask: "which train did we book to kyoto?", expect: /nozomi\s*21/i },
  { at: 23, from: "ada", said: "done, booked. seats 4d and 4e, car 7." },
  { at: 40, said: meetingNotes, ask: "when does the vendor contract renew, and for how much?", expect: /feb(ruary)?\s*28.*18[,.]?400|18[,.]?400.*feb(ruary)?\s*28/i },
  { at: 64, said: "no, don't put the photos on the shared drive, my dad can see everything there. use the private album instead", ask: "where should the photos go, and why?", expect: /private.*(dad|father)|(dad|father).*private/i },
  { at: 91, from: "bob", said: "the wifi password at the cabin is cedar-lake-77, it's on the fridge too" , ask: "what's the cabin wifi password?", expect: /cedar-?lake-?77/i },
  { at: 120, said: "kitchen budget is 12k, including the island" },
  { at: 131, from: "kiko", said: "i tried to cancel the gym membership on their site but it only lets you cancel by phone, so it's still active. their number is on the last invoice.", ask: "is the gym membership cancelled?", expect: /(still|not|isn'?t|hasn'?t|wasn'?t).*(active|cancel)|phone|call/i },
  { at: 160, said: "rule for me: never schedule anything before 9am on weekends, i need the mornings", ask: "what's my rule for weekend mornings?", expect: /9/ },
  { at: 200, said: "the plumber is coming tuesday between 2 and 4, his name is luis", ask: "what's the plumber's name?", expect: /luis/i },
  { at: 256, said: "let's call the house project bluebird from now on", ask: "what did we name the house project?", expect: /bluebird/i },
  { at: 301, from: "ada", said: "your dentist slot on the 9th clashes with the plumber follow-up. should i move the dentist to friday the 14th at 11?" },
  { at: 302, said: "do that", ask: "when is my dentist appointment now?", expect: /fri(day)?.*14|14.*fri(day)?|14th/i },
  { at: 303, from: "ada", said: "moved, they confirmed by email." },
  { at: 340, said: "actually the kitchen budget is 9k now, not 12k. we cut the island", ask: "what is the kitchen budget now?", expect: /9\s?k|9[,.]?000/i, reject: /12\s?k|12[,.]?000/i },
  { at: 420, said: "my locker code at the pool is 4417", ask: "what's my pool locker code?", expect: /4417/ },
  {
    at: 471,
    from: "bob",
    said: `${"went through the whole shared folder, sorted the quotes by trade, threw out the duplicates of the tile quote, and merged the two electrician estimates into one sheet with the totals at the bottom. ".repeat(2)}also renamed the shared folder to /bluebird-final so nobody uploads to the old one.`,
    ask: "what is the shared folder called now?",
    expect: /bluebird-final/i,
  },
  { at: 520, said: "switched my phone plan to mint, 15 a month", ask: "which phone plan am i on?", expect: /mint/i },
  { at: 600, said: "remember anna is vegetarian when we book the dinner", ask: "what does anna not eat?", expect: /vegetarian|meat/i },
]

const FILLER_HUMAN = [
  "what's the weather looking like for the weekend",
  "can you look at the draft again later",
  "ok",
  "remind me what we said about the museum",
  "lol",
  "i'm tired today, short answers please",
  "any good ramen spots near the station?",
  "let's keep going tomorrow",
  "how many emails did i get from the bank this week",
  "push the sync with marco to 3",
  "thanks",
  "what's on my calendar thursday",
]
const FILLER_AGENT = [
  "rain on saturday, 14 degrees; sunday clears up by noon, 17 degrees.",
  "sure, i'll go over it tonight and leave comments inline.",
  "👍",
  "we said the museum is a maybe, only if it rains. if it does, the mori art museum and the edo-tokyo one are both near the line we take every day, and neither needs a booking on a weekday.",
  "ha.",
  "got it.",
  "fuunji near the south exit is the classic pick; menya musashi is 6 minutes away if the line is long.",
  "works for me.",
  "three from the bank: two statements and one about the new card ending 2290. nothing needs an answer.",
  "moved the sync with marco to 15:00 and he accepted.",
  "anytime.",
  "thursday: 10:00 standup, 13:30 lunch with jo at the usual place, 16:00 call with the architect about the bluebird drawings.",
]

export const hard: Eval = { name: "memory-hard", turns: 640, facts: FACTS, pass: 12, fillerHuman: FILLER_HUMAN, fillerAgent: FILLER_AGENT }

export default memorySuite(hard)
